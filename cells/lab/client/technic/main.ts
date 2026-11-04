/**
 * Technic: a pegboard, a tray of pieces, and a machine that goes.
 *
 * Bricks evolved: beams with holes instead of bricks with studs, pins and axles through them,
 * gears that mesh, wheels that roll, a motor, and a hub that tells the motor what to do. Pieces
 * lie in layers in front of the board; pins and axles go through, across the layers, and into
 * the board (a tight pin holds, an axle is a pivot). Take a piece from the tray, drag it where it
 * goes: a beam by the hole you hold it by, a pin or a gear onto a hole. Tap `run` and it moves:
 * gravity, the floor, the motor turning; drag anything to pull on it. Tap the hub for its
 * program: a speed for each motor, and a rule (run; to and fro; turn back at the walls; turn
 * back when tipped). `stop` puts it all back as built.
 *
 * The rules are in pieces.ts and the solver in sim.ts, both tested on their own. Here is the
 * drawing (WebGL2: each kind of piece one mesh, instanced; glossy plastic lit by a sun, its
 * shadows thrown onto the floor and the board) and the hands.
 */
import { BALL_R, BEAM_COLOURS, BH, BOARD, BW, COLOURS, FLOOR, RULES, TRAY, TRAY_GROUPS, XMAX, XMIN, World, cellsOf, defaultPort, demo, isDisc, isGoal, isPlanar, localCells, missions, radiusOf, rampLength, rotXY, spanOf, type C3, type Hole, type Kind, type Mech, type Mission, type Piece, type Port } from './pieces';
import { Controller, Sim, TURNS } from './sim';
import { glyph, schematic } from './glyph';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
/** runs by itself: the lab's preview, or `?auto` to watch a machine full size */
const auto = preview || params.has('auto');
const STORE = 'technic:v1';

const canvas = document.getElementById('build') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true })!;
if (!gl) throw new Error('WebGL2 is needed');
if (auto) document.body.classList.add('preview');

type V2 = [number, number];

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform vec3 uTop, uLow;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() { o = vec4(mix(uLow, uTop, smoothstep(.1, 1., vUV.y)) + (h(gl_FragCoord.xy) - .5) / 255., 1.); }`;

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aOff;
in float aAng;
in vec3 aCol;
in float aKind;
uniform mat4 uVP;
uniform vec3 uSun;
uniform float uShadow; // 0 none; 1 onto the floor; 2 onto the board
uniform float uFloor, uBoard;
out vec3 vWorld;
out vec3 vNor;
out vec3 vCol;
flat out float vKind;
void main() {
  float c = cos(aAng), s = sin(aAng);
  vec3 p = vec3(c * aPos.x - s * aPos.y, s * aPos.x + c * aPos.y, aPos.z) + aOff;
  vec3 n = vec3(c * aNor.x - s * aNor.y, s * aNor.x + c * aNor.y, aNor.z);
  if (uShadow > 1.5) p -= uSun * ((p.z - uBoard) / uSun.z);
  else if (uShadow > .5) p -= uSun * ((p.y - uFloor) / uSun.y);
  vWorld = p;
  vNor = n;
  vCol = aCol;
  vKind = aKind;
  gl_Position = uVP * vec4(p, 1.);
  if (uShadow > .5) gl_Position.z -= .0005;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vCol;
flat in float vKind; // 0 a piece; 1 see-through (on its way); 2 selected; 3 dull (rubber); 4 see-through, in the way; 5 moves with the selected
out vec4 o;
uniform vec3 uSun, uEye, uFog;
uniform float uTime, uNear, uShadow, uPlain;
void main() {
  if (uShadow > .5) { o = vec4(0., 0., 0., .22); return; }
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  float breathe = .5 + .5 * sin(uTime * 2.4);
  vec3 base = vCol;
  if (vKind > 1.5 && vKind < 2.5) base = mix(base, vec3(1.), .18 + .14 * breathe);
  if (vKind > 4.5) base = mix(base, vec3(1., .96, .7), .22 + .08 * breathe);
  if (vKind > 3.5 && vKind < 4.5) base = mix(base, vec3(.85, .15, .1), .7);
  float diff = max(0., dot(n, uSun));
  // sky from above, a little warm bounce from below, the sun; and the plastic's shine
  vec3 light = vec3(.62, .65, .7) * (.72 + .28 * n.y) + vec3(.1, .09, .08) * max(0., -n.y);
  light += vec3(1., .95, .86) * diff * .66;
  vec3 c = base * light;
  vec3 hv = normalize(uSun + V);
  float gloss = vKind > 2.5 ? .08 : .42;
  float sharp = vKind > 2.5 ? 14. : 70.;
  c += vec3(1., .97, .92) * pow(max(dot(n, hv), 0.), sharp) * gloss;
  c += vec3(.85, .9, 1.) * pow(1. - max(dot(n, V), 0.), 5.) * .12;
  if (uPlain < .5) {
    float d = length(vWorld - uEye);
    c = mix(c, uFog, smoothstep(uNear, uNear + 70., d) * .5);
  }
  if ((vKind > .5 && vKind < 1.5) || (vKind > 3.5 && vKind < 4.5)) {
    // see-through: its colour, breathing
    float al = .5 + .12 * breathe;
    o = vec4(c * al, al);
    return;
  }
  o = vec4(c, 1.);
}`;

// the board and the floor: flat, with their holes and lines drawn in
const FLAT_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uVP;
out vec3 vWorld;
void main() { vWorld = aPos; gl_Position = uVP * vec4(aPos, 1.); }`;
const FLAT_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
out vec4 o;
uniform vec3 uEye, uFog, uSun;
uniform float uWhich; // 0 the board, 1 the floor, 2 a layer's face (glass), 3 the landing layer's
uniform float uNear, uXMin, uXMax;
void main() {
  vec3 c;
  if (uWhich > 1.5) {
    // a sheet of glass: faint, its edge a little brighter; the landing one lit
    vec2 f = fract(vWorld.xy + .5) - .5;
    float dots = 1. - smoothstep(.06, .1, length(f));
    float lit = uWhich > 2.5 ? 1. : 0.;
    o = vec4(mix(vec3(.75, .8, .9), vec3(1., .95, .7), lit), mix(.07, .16, lit) + dots * mix(.12, .3, lit));
    return;
  }
  if (uWhich < .5) {
    // the board: a hole at every module, dark inside, a soft rim
    vec2 f = fract(vWorld.xy + .5) - .5;
    float r = length(f);
    vec3 paper = vec3(.80, .78, .72);
    float hole = 1. - smoothstep(.27, .31, r);
    float rim = smoothstep(.31, .36, r) * (1. - smoothstep(.36, .42, r));
    c = mix(paper, vec3(.18, .17, .16), hole);
    c = mix(c, paper * 1.06, rim * .5);
    c *= .92 + .08 * uSun.y;
  } else {
    // the floor: a fine grid, the walls as lines
    vec2 g = abs(fract(vWorld.xz + .5) - .5);
    float line = 1. - smoothstep(.0, .035, min(g.x, g.y));
    c = vec3(.86, .86, .84);
    c = mix(c, vec3(.74, .74, .72), line * .5);
    float wall = (1. - smoothstep(.0, .12, abs(vWorld.x - uXMin))) + (1. - smoothstep(.0, .12, abs(vWorld.x - uXMax)));
    c = mix(c, vec3(.45, .4, .36), clamp(wall, 0., 1.) * .8);
  }
  float d = length(vWorld - uEye);
  c = mix(c, uFog, smoothstep(uNear, uNear + 70., d) * .5);
  o = vec4(c, 1.);
}`;

function program(vs: string, fs: string): WebGLProgram {
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
const skyProg = program(SKY_VS, SKY_FS);
const prog = program(VS, FS);
const flatProg = program(FLAT_VS, FLAT_FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── meshes: each kind of piece, from its outline ───────────────────────────────────────────────
/** the hole in a beam (4.8 mm on an 8 mm pitch), and an axle's cross */
const HOLE_R = 0.3;
const AXLE_HALF = 0.29;
const AXLE_ARM = 0.1;
const PIN_R = 0.28;

/** How far the outline of a plus-shaped axle is from its centre, in a direction. */
function crossR(t: number): number {
  const c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const arm1 = Math.min(c > 1e-9 ? AXLE_HALF / c : 1e9, s > 1e-9 ? AXLE_ARM / s : 1e9);
  const arm2 = Math.min(s > 1e-9 ? AXLE_HALF / s : 1e9, c > 1e-9 ? AXLE_ARM / c : 1e9);
  return Math.max(arm1, arm2);
}
/** The angles to sample an outline at: evenly, and at every corner there is. */
function angles(steps: number, corners: number[]): number[] {
  const set = new Set<number>();
  for (let i = 0; i < steps; i++) set.add(((i / steps) * Math.PI * 2) % (Math.PI * 2));
  for (const c of corners) set.add(((c % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  return [...set].sort((a, b) => a - b);
}
const CROSS_CORNERS = [AXLE_ARM / AXLE_HALF, AXLE_HALF / AXLE_ARM].flatMap((k) => { const a = Math.atan(k); return [a, Math.PI - a, Math.PI + a, -a]; }).concat([Math.atan2(AXLE_ARM, AXLE_HALF), Math.atan2(AXLE_HALF, AXLE_ARM)].flatMap((a) => [a, Math.PI - a, Math.PI + a, 2 * Math.PI - a]));
const SQUARE_CORNERS = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

/**
 * A ring of material between an outer outline and an inner one (or none: a disc), from z0 to
 * z1: its front and back, the inner wall, and the outer wall where `wall` says there is one.
 */
function ring(ts: number[], outer: (t: number) => number, inner: ((t: number) => number) | null, z0: number, z1: number, wall: (t0: number, t1: number) => boolean, out: number[], cx = 0, cy = 0) {
  const push = (p: number[], n: number[]) => out.push(p[0] + cx, p[1] + cy, p[2], n[0], n[1], n[2]);
  for (let i = 0; i < ts.length; i++) {
    const t0 = ts[i], t1 = ts[(i + 1) % ts.length];
    const o0 = outer(t0), o1 = outer(t1);
    const O0 = [Math.cos(t0) * o0, Math.sin(t0) * o0], O1 = [Math.cos(t1) * o1, Math.sin(t1) * o1];
    const i0 = inner ? inner(t0) : 0, i1 = inner ? inner(t1) : 0;
    const I0 = [Math.cos(t0) * i0, Math.sin(t0) * i0], I1 = [Math.cos(t1) * i1, Math.sin(t1) * i1];
    // front (+z) and back (-z)
    for (const [z, nz] of [[z1, 1], [z0, -1]] as const) {
      const n = [0, 0, nz];
      if (inner) {
        push([O0[0], O0[1], z], n); push([O1[0], O1[1], z], n); push([I1[0], I1[1], z], n);
        push([O0[0], O0[1], z], n); push([I1[0], I1[1], z], n); push([I0[0], I0[1], z], n);
      } else {
        push([0, 0, z], n); push([O0[0], O0[1], z], n); push([O1[0], O1[1], z], n);
      }
    }
    // the walls
    const side = (A: number[], B: number[], inward: boolean) => {
      let nx = B[1] - A[1], ny = -(B[0] - A[0]);
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      if (inward) { nx = -nx; ny = -ny; }
      const n = [nx, ny, 0];
      push([A[0], A[1], z0], n); push([B[0], B[1], z0], n); push([B[0], B[1], z1], n);
      push([A[0], A[1], z0], n); push([B[0], B[1], z1], n); push([A[0], A[1], z1], n);
    };
    if (wall(t0, t1)) side(O0, O1, false);
    if (inner) side(I0, I1, true);
  }
}
const circle = (r: number) => () => r;
const square = (t: number) => 0.5 / Math.max(Math.abs(Math.cos(t)), Math.abs(Math.sin(t)));

/**
 * A flat piece from its cells: each a square of material (rounded at an outside corner) round
 * its hole, joined to its neighbours.
 */
function flatMesh(cells: Array<{ i: number; j: number; hole: Hole }>, z0 = 0, z1 = 1): number[] {
  const out: number[] = [];
  const has = (i: number, j: number) => cells.some((c) => c.i === i && c.j === j);
  for (const c of cells) {
    const nb = [has(c.i + 1, c.j), has(c.i, c.j + 1), has(c.i - 1, c.j), has(c.i, c.j - 1)]; // +x +y -x -y
    const outer = (t: number) => {
      const cs = Math.cos(t), sn = Math.sin(t);
      const qx = cs >= 0 ? 0 : 2, qy = sn >= 0 ? 1 : 3;
      // (an outside corner, between two missing neighbours, is rounded)
      return !nb[qx] && !nb[qy] ? 0.5 : square(t);
    };
    const wall = (t0: number, t1: number) => {
      const m = (t0 + t1) / 2 + (t1 < t0 ? Math.PI : 0);
      const cs = Math.cos(m), sn = Math.sin(m);
      const r = outer(m);
      const x = cs * r, y = sn * r;
      // (a wall on the side of a neighbour is inside the piece)
      if (Math.abs(x - 0.5) < 1e-3 && nb[0]) return false;
      if (Math.abs(x + 0.5) < 1e-3 && nb[2]) return false;
      if (Math.abs(y - 0.5) < 1e-3 && nb[1]) return false;
      if (Math.abs(y + 0.5) < 1e-3 && nb[3]) return false;
      return true;
    };
    const inner = c.hole === 'round' ? circle(HOLE_R) : c.hole === 'axle' ? crossR : null;
    ring(angles(40, [...SQUARE_CORNERS, ...(c.hole === 'axle' ? CROSS_CORNERS : [])]), outer, inner, z0, z1, wall, out, c.i, c.j);
  }
  return out;
}
function gearMesh(teeth: number): number[] {
  const rp = teeth / 16;
  const outer = (t: number) => {
    const u = ((t / (Math.PI * 2)) * teeth) % 1;
    const k = Math.abs(u - 0.5);
    const f = k < 0.18 ? 1 : k > 0.34 ? 0 : (0.34 - k) / 0.16;
    return rp - 0.1 + 0.2 * f;
  };
  const out: number[] = [];
  ring(angles(teeth * 10, CROSS_CORNERS), outer, crossR, 0.08, 0.92, () => true, out);
  // (the small gear is solid to its hub; the big ones have a lighter web)
  return out;
}
function discMesh(outerR: number, inner: ((t: number) => number) | null, z0: number, z1: number): number[] {
  const out: number[] = [];
  ring(angles(48, inner === crossR ? CROSS_CORNERS : []), circle(outerR), inner, z0, z1, () => true, out);
  return out;
}
/** A ramp: a stadium as long as the ramp, a hole at each end (dark liners, drawn through it). */
function stadiumMesh(len: number): number[] {
  const a = len / 2;
  const outer = (t: number) => {
    const c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
    const flat = sn > 1e-9 ? 0.5 / sn : 1e9;
    if (flat * c <= a) return flat;
    return a * c + Math.sqrt(Math.max(0, 0.25 - a * a * sn * sn));
  };
  const corner = Math.atan2(0.5, a);
  const out: number[] = [];
  ring(angles(64, [corner, Math.PI - corner, Math.PI + corner, 2 * Math.PI - corner]), outer, null, 0.02, 0.98, () => true, out, a, 0);
  return out;
}
function linerMesh(): number[] {
  const out: number[] = [];
  ring(angles(20, []), circle(HOLE_R), null, -0.01, 1.01, () => true, out);
  return out;
}
function sphereMesh(r: number): number[] {
  const out: number[] = [];
  const S = 18, R = 12;
  const at = (i: number, j: number): C3 => {
    const th = (i / S) * Math.PI * 2, ph = (j / R) * Math.PI;
    return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
  };
  const push = (n: C3) => out.push(n[0] * r, n[1] * r, 0.5 + n[2] * r, n[0], n[1], n[2]);
  for (let j = 0; j < R; j++) for (let i = 0; i < S; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    push(a); push(b); push(c); push(a); push(c); push(d);
  }
  return out;
}
function pinMesh(n: number): number[] {
  const out: number[] = [];
  ring(angles(20, []), circle(PIN_R), null, 0.06, n - 0.06, () => true, out);
  // its collar, between the first two layers
  ring(angles(20, []), circle(PIN_R + 0.08), null, 0.94, 1.06, () => true, out);
  return out;
}
function axleMesh(n: number): number[] {
  const out: number[] = [];
  ring(angles(8, CROSS_CORNERS), crossR, null, 0.03, n - 0.03, () => true, out);
  return out;
}

interface Mesh { vao: WebGLVertexArrayObject; count: number; inst: WebGLBuffer; data: number[]; n: number }
const STRIDE = 8;
const ATTRS = [['aOff', 3, 0], ['aAng', 1, 3], ['aCol', 3, 4], ['aKind', 1, 7]] as const;
const meshes = new Map<string, Mesh>();
function mesh(key: string, make: () => number[]): Mesh {
  let m = meshes.get(key);
  if (m) return m;
  const verts = make();
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  for (const [name, size, off] of [['aPos', 3, 0], ['aNor', 3, 3]] as const) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off * 4);
  }
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  for (const [name, size, off] of ATTRS) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  m = { vao, count: verts.length / 6, inst, data: [], n: 0 };
  meshes.set(key, m);
  return m;
}
/** The meshes a piece is drawn with, each with its colour. */
function meshesOf(p: { kind: Kind; n: number; m?: number; colour: number }): Array<{ m: Mesh; colour: C3; dull?: boolean; at?: V2 }> {
  const c = COLOURS[p.colour].rgb;
  switch (p.kind) {
    case 'beam': case 'crank': case 'motor': case 'hub':
      return [{ m: mesh(`${p.kind}-${p.n}`, () => flatMesh(localCells(p.kind, p.n), 0.02, 0.98)), colour: c }];
    case 'gear': return [{ m: mesh(`gear-${p.n}`, () => gearMesh(p.n)), colour: c }];
    case 'wheel': {
      const r = radiusOf(p);
      return [
        { m: mesh(`tyre-${p.n}`, () => discMesh(r, circle(r - 0.62), 0.0, 1.0)), colour: [0.1, 0.1, 0.1], dull: true },
        { m: mesh(`rim-${p.n}`, () => discMesh(r - 0.6, crossR, 0.12, 0.88)), colour: COLOURS[0].rgb },
      ];
    }
    case 'pin': return [{ m: mesh(`pin-${p.n}`, () => pinMesh(p.n)), colour: c }];
    case 'axle': return [{ m: mesh(`axle-${p.n}`, () => axleMesh(p.n)), colour: c }];
    case 'ramp': {
      const len = rampLength(p);
      return [{ m: mesh(`ramp-${len.toFixed(2)}`, () => stadiumMesh(len)), colour: c }, { m: mesh('liner', linerMesh), colour: [0.16, 0.16, 0.17], at: [0, 0] }, { m: mesh('liner', linerMesh), colour: [0.16, 0.16, 0.17], at: [len, 0] }];
    }
    case 'ball': return [{ m: mesh('ball', () => sphereMesh(BALL_R)), colour: c }];
    case 'cup': return [{ m: mesh('cup', () => flatMesh(localCells('cup', 0), 0.02, 0.98)), colour: c }];
    case 'bell': return [{ m: mesh('bell', () => discMesh(0.9, crossR, 0.1, 0.9)), colour: [0.85, 0.68, 0.2] }, { m: mesh('bell-clapper', () => discMesh(0.22, null, 0.92, 1.0)), colour: [0.2, 0.18, 0.16], at: [0, -0.55] }];
  }
}
/** A thin ring in a layer's face: a gear's pitch circle, shown while one is carried. */
function ringMesh(r: number): number[] {
  const out: number[] = [];
  ring(angles(64, []), circle(r + 0.03), circle(r - 0.03), 0.99, 1.02, () => true, out);
  return out;
}
/** A flat piece's turn as built: its quarter turns, or a ramp's slope. */
function restAngle(p: { kind: Kind; n: number; m?: number; rot: number }): number {
  if (!isPlanar(p.kind)) return 0;
  if (p.kind === 'ramp') {
    const [dx, dy] = rotXY(p.n, -(p.m ?? 0), p.rot);
    return Math.atan2(dy, dx);
  }
  return (p.rot * Math.PI) / 2;
}
function instance(m: Mesh, x: number, y: number, z: number, ang: number, colour: C3, kind: number, at: V2 = [0, 0]) {
  const c = Math.cos(ang), sn = Math.sin(ang);
  m.data.push(x + c * at[0] - sn * at[1], y + sn * at[0] + c * at[1], z, ang, colour[0], colour[1], colour[2], kind);
  m.n++;
}
function flush() {
  for (const m of meshes.values()) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.inst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.data), gl.DYNAMIC_DRAW);
    m.data = [];
  }
}
function drawAll() {
  for (const m of meshes.values()) {
    if (!m.n) continue;
    gl.bindVertexArray(m.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.n);
  }
}
function clearCounts() {
  for (const m of meshes.values()) m.n = 0;
}

// the board and the floor
const flatVao = gl.createVertexArray()!;
const flatBuf = gl.createBuffer()!;
{
  const x0 = -0.5, x1 = BW - 0.5, y0 = -0.5, y1 = BH - 0.5, zb = 0;
  const fx0 = XMIN - 12, fx1 = XMAX + 12, fz0 = -1.2, fz1 = 16;
  const v = [
    x0, y0, zb, x1, y0, zb, x1, y1, zb, x0, y0, zb, x1, y1, zb, x0, y1, zb,
    fx0, FLOOR, fz0, fx1, FLOOR, fz0, fx1, FLOOR, fz1, fx0, FLOOR, fz0, fx1, FLOOR, fz1, fx0, FLOOR, fz1,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ];
  gl.bindVertexArray(flatVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, flatBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  const loc = gl.getAttribLocation(flatProg, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 12, 0);
  gl.bindVertexArray(null);
}
const skyVao = gl.createVertexArray()!;

// ─── the build ─────────────────────────────────────────────────────────────────────────────────
let world = new World();
/** the hub's program: a port per motor, in the order the motors were placed */
let ports: Port[] = [];
/** what's been done, to undo: pieces put in, a piece changed, a piece taken out */
type Act = { add: number[] } | { change: number; from: Piece; to: Piece } | { remove: number; piece: Piece };
let history: Act[] = [];
/** the piece in hand, from the tray */
let hand = 0;
let handRot = 0;
/** the placed piece that's selected (-1: none) */
let selected = -1;
/** a piece on its way: out of the tray (`from` -1), or lifted off the build to move; or a whole build of yours, as a group */
let carry: { spec: Omit<Piece, 'at' | 'z'>; from: number; original: Piece | null; anchor: V2; zHint: number; group?: Piece[] } | null = null;
/** a build in hand, from the drawer (instead of a tray piece) */
let handBuild: Build | null = null;
/** where it would go, with what it brings (an axle, pins); or where it can't, and why; a group, all of it */
let ghost: { piece: Piece; extra?: Piece; pins?: Piece[]; blocked?: { reason: string; id?: number }; meshWith?: number; group?: Piece[] } | null = null;
let simLag = 0;

interface Saved { pieces: Piece[]; ports: Port[]; hand: number }
function save() {
  if (auto) return;
  if (mission) {
    missionWork[mission.id] = { pieces: world.list(), ports };
    storeMissions();
    return;
  }
  const b = builds.find((x) => x.id === current);
  if (b) {
    b.pieces = world.list();
    b.ports = ports;
    b.savedAt = Date.now();
    // (the most recent first)
    builds.sort((p, q) => q.savedAt - p.savedAt);
  }
  storeBuilds();
  try { localStorage.setItem(STORE + ':hand', String(hand)); } catch { /* */ }
}
function loadDemo(name: string) {
  world = new World();
  history = [];
  const d = demo(name);
  for (const p of d.pieces) if (world.fits(p)) world.add(p);
  ports = d.ports;
}
function load() {
  const d = params.get('demo');
  if (auto || d) {
    loadDemo(d ?? 'crank');
    rebuild(false);
    return;
  }
  loadBuilds();
  loadMissions();
  try { hand = Math.min(TRAY.length - 1, Number(localStorage.getItem(STORE + ':hand') ?? 0) || 0); } catch { /* */ }
  // (`?mission=<id>`: straight into one, fresh)
  const mi = MISSIONS.find((m) => m.id === params.get('mission'));
  if (mi) { startMission(mi, true); return; }
  const b = builds.find((x) => x.id === current);
  if (b) {
    for (const p of b.pieces) if (world.fits(p)) world.add(p);
    ports = b.ports.map((x) => ({ ...x }));
  }
  rebuild(false);
  showTitle();
  // (the start screen, to pick up where you were or start from something)
  showStart();
}

// ─── always alive ──────────────────────────────────────────────────────────────────────────────
/** The machine, always: rebuilt as the build changes, keeping where everything has got to. */
let sim: Sim = new Sim(world.mechanism());
let ctl: Controller = new Controller(ports);
let playing = true;
/** The build changed: a new machine, taking over where the old one had got to (or, rewound, as built). */
function rebuild(keep = true) {
  const old = sim;
  const oldWorld = old.mech.bodyOf;
  sim = new Sim(world.mechanism());
  if (keep) sim.adopt(old, (id) => (id < oldWorld.length ? oldWorld[id] : -1));
  ctl.ports = ports;
  ctl.rebind();
  finger = null;
  if (!keep) { inBell.clear(); cupT = 0; }
  if (keep && sim.motors.length && !sim.mech.hubs.length && !said_noHub) { showWhy('the motor needs the hub: nothing is powered', 4000); said_noHub = true; }
  if (sim.mech.hubs.length) said_noHub = false;
}
let said_noHub = false;
/** Back to as built (still playing, if it was). */
function rewind() {
  rebuild(false);
  tick(1.5);
}
function setPlaying(on: boolean) {
  playing = on;
  document.body.classList.toggle('paused', !on);
  showRun();
  if (!on) rollAt(0);
}
function showRun() {
  $('run').textContent = playing ? 'pause' : 'play';
}

// ─── what a hand does ──────────────────────────────────────────────────────────────────────────
/** what moves with the selected piece (its body), and the points it turns about */
let kin: { pieces: Set<number>; joints: Array<[number, number, number]>; words: string } | null = null;
function reveal(id: number) {
  kin = null;
  const p = world.pieces[id];
  if (!p) return;
  const m: Mech = world.mechanism();
  const b = m.bodyOf[id];
  const pieces = new Set<number>();
  if (b > 0) for (const q of m.bodies[b].pieces) pieces.add(q);
  const joints: Array<[number, number, number]> = [];
  for (const j of m.joints) if (j.a === b || j.b === b) joints.push([j.x, j.y, p.z + 1]);
  const bits: string[] = [];
  if (b === 0) bits.push('held by the board');
  else if (joints.length === 1) bits.push('turns about one point');
  else if (joints.length > 1) bits.push(`joined at ${joints.length} points`);
  else bits.push('loose: it will fall');
  const mates = world.meshes(p);
  for (const q of mates) {
    const r = world.pieces[q]!.n / p.n;
    bits.push(`meshes with the gear ${world.pieces[q]!.n} (${r === 1 ? 'the same speed' : r > 1 ? `${trim(r)}× faster` : `${trim(1 / r)}× slower`})`);
  }
  if (pieces.size > 1) bits.push(`moves with ${pieces.size - 1} other${pieces.size > 2 ? 's' : ''}`);
  kin = { pieces, joints, words: `${nameOf(p)}, layer ${p.z + 1}: ${bits.join(' · ')}` };
}
function select(id: number) {
  if (id !== selected && id >= 0) tick(1.5);
  selected = id;
  document.body.classList.toggle('has-sel', id >= 0);
  if (id >= 0) { reveal(id); showWhy(kin?.words ?? '', 4000); } else { kin = null; }
  if (id >= 0) {
    const p = world.pieces[id]!;
    document.body.classList.toggle('sel-colour', p.kind === 'beam' || p.kind === 'crank');
    document.body.classList.toggle('sel-hub', p.kind === 'hub');
  }
}
const handSpec = (): Omit<Piece, 'at' | 'z'> => ({ ...TRAY[hand].spec, rot: handRot });
/** Take the piece in hand out of the tray. */
function pickUp() {
  if (handBuild) {
    const g = handBuild.pieces.map((p) => ({ ...p, at: [...p.at] as V2 }));
    const first = g.find((p) => isPlanar(p.kind)) ?? g[0];
    if (!first) return;
    carry = { spec: { ...first }, from: -1, original: null, anchor: [0, 0], zHint: first.z, group: g };
    ghost = null;
    leanBack(true);
    return;
  }
  const spec = handSpec();
  // (a beam by its middle, a block by its first hole)
  const anchor: V2 = spec.kind === 'beam' ? [Math.floor((spec.n - 1) / 2), 0] : [0, 0];
  carry = { spec, from: -1, original: null, anchor, zHint: 0 };
  ghost = null;
  leanBack(true);
}
/** Lift a placed piece off the build, by the hole under the finger, to move it. */
function lift(id: number, anchor: V2) {
  const p = world.pieces[id];
  if (!p) return;
  world.remove(id);
  const { at, z, ...spec } = p;
  carry = { spec, from: id, original: p, anchor, zHint: z };
  ghost = { piece: p };
  leanBack(true);
  rebuild();
}
/** The carried piece follows the finger: the hole it's held by lands in the cell under it. */
function carryTo(px: number, py: number) {
  if (!carry) return;
  whyUntil = 0;
  if (carry.group) return carryGroupTo(px, py);
  const spec = carry.spec;
  let found: { piece: Piece; extra?: Piece; pins?: Piece[]; meshWith?: number } | null = null;
  let tried: Piece | null = null;
  if (isPlanar(spec.kind) && !isDisc(spec.kind)) {
    // (the cell under the finger, on the layer it would land in: tried from the back forward)
    for (let z = Math.max(0, carry.zHint); z < 9 && !found; z++) {
      const c = cellAt(px, py, z + 1);
      if (!c) break;
      const [ax, ay] = rotXY(carry.anchor[0], carry.anchor[1], spec.rot);
      if (!tried) tried = { ...spec, at: [c[0] - ax, c[1] - ay], z };
      const r = world.place(spec, c[0], c[1], carry.anchor, z);
      if (r && r.piece.z === z) found = r;
    }
    if (!found) {
      const c = cellAt(px, py, 1);
      if (c) found = world.place(spec, c[0], c[1], carry.anchor, 0);
    }
    if (found) found.pins = world.connections(found.piece);
  } else {
    // a pin, an axle, a gear: onto the hole under the finger, the front one there
    const h = holeUnder(px, py);
    if (h) {
      // (a gear near another is drawn to mesh with it)
      const snap = world.meshSnap(spec, h[0], h[1]);
      if (snap) {
        found = world.place(spec, snap.x, snap.y, [0, 0], snap.z);
        if (found && found.piece.z === snap.z) found.meshWith = snap.with;
        else found = world.place(spec, h[0], h[1], [0, 0], h[2]);
      } else found = world.place(spec, h[0], h[1], [0, 0], h[2]);
      tried = { ...spec, at: [h[0], h[1]], z: spec.kind === 'pin' || spec.kind === 'axle' ? h[2] : Math.max(0, h[2]) };
    }
  }
  if (!found) {
    // (nowhere: shown where it was tried, red, and why)
    if (tried) {
      const why = world.why(tried, carry.from);
      const wasBlocked = ghost?.blocked;
      ghost = { piece: tried, blocked: why ? { reason: why.reason, id: why.id } : { reason: 'room' } };
      if (!wasBlocked) tick(0.5);
    } else ghost = null;
    showWhy();
    return;
  }
  const g = ghost;
  if (!g || g.blocked || g.piece.at[0] !== found.piece.at[0] || g.piece.at[1] !== found.piece.at[1] || g.piece.z !== found.piece.z) tick();
  ghost = found;
  showWhy();
}
/** A build of yours carried: all of it moves together, by its first piece, in its own layers. */
function carryGroupTo(px: number, py: number) {
  const g = carry!.group!;
  const first = g.find((p) => isPlanar(p.kind)) ?? g[0];
  const c = cellAt(px, py, first.z + 1);
  if (!c) { ghost = null; showWhy(); return; }
  const dx = c[0] - first.at[0], dy = c[1] - first.at[1];
  const moved = g.map((p) => ({ ...p, at: [p.at[0] + dx, p.at[1] + dy] as V2 }));
  // (every piece of it must fit, and its pins and axles too)
  let bad: { reason: string; id?: number } | null = null;
  for (const p of moved) {
    const why = world.why(p);
    if (why) { bad = { reason: why.reason, id: why.id }; break; }
  }
  const was = ghost?.piece;
  const piece = moved.find((p) => isPlanar(p.kind)) ?? moved[0];
  if (!was || was.at[0] !== piece.at[0] || was.at[1] !== piece.at[1]) tick(bad ? 0.5 : 1);
  ghost = bad ? { piece, group: moved, blocked: bad } : { piece, group: moved };
  showWhy();
}
/** The caption over the build: why a piece can't go, what it will do, what just happened. */
let whyUntil = 0;
function showWhy(text?: string, ms = 0) {
  const el = $('why');
  if (text !== undefined) {
    el.innerHTML = text;
    el.classList.toggle('on', !!text);
    whyUntil = ms ? performance.now() + ms : 0;
    return;
  }
  if (whyUntil > performance.now()) return;
  let t = '';
  if (ghost?.blocked) {
    const b = ghost.blocked;
    const other = b.id !== undefined && world.pieces[b.id] ? nameOf(world.pieces[b.id]!) : '';
    t = b.reason === 'board' ? 'off the board' : b.reason === 'hole' ? `no hole for it here${other ? `: the ${other} is solid there` : ''}` : b.reason === 'piece' ? `in the way: the ${other}` : 'no room here';
    if (b.reason === 'piece' && isPlanar(ghost.piece.kind) && !isDisc(ghost.piece.kind)) t += ' <button id="why-front">put it in front</button>';
  } else if (ghost?.group) {
    t = `${handBuild?.name ?? 'your build'}: ${ghost.group.length} pieces, as kept`;
  } else if (ghost) {
    const p = ghost.piece;
    if (ghost.meshWith !== undefined) {
      const q = world.pieces[ghost.meshWith]!;
      const ratio = q.n / p.n;
      t = `meshes with the gear ${q.n}: ${ratio === 1 ? 'the same speed' : ratio > 1 ? `${trim(ratio)} times faster` : `${trim(1 / ratio)} times slower`}, the other way`;
    } else if (ghost.pins?.length === 1) t = 'one pin: it turns there';
    else if (ghost.pins && ghost.pins.length >= 2) t = 'two pins: held fast';
    else if (ghost.extra) t = `with an axle${ghost.extra.z === BOARD ? ' into the board: it turns there' : ''}`;
    else if (p.kind === 'ball') t = `in layer ${p.z + 1}: it rolls on what's there`;
    else if (p.kind === 'pin') t = p.z === BOARD ? 'into the board' : 'through both';
    else if (p.kind === 'axle') t = p.z === BOARD ? 'into the board: a pivot' : 'through';
  }
  el.innerHTML = t;
  el.classList.toggle('on', !!t);
}
const trim = (v: number) => (Math.round(v * 10) / 10).toString();
/** A piece, named. */
function nameOf(p: Piece): string {
  const col = COLOURS[p.colour].name;
  switch (p.kind) {
    case 'beam': return `${col} beam`;
    case 'crank': return 'crank';
    case 'ramp': return `${col} ramp`;
    case 'pin': return p.friction ? 'tight pin' : 'pin';
    case 'axle': return 'axle';
    case 'gear': return `gear ${p.n}`;
    case 'wheel': return 'wheel';
    case 'motor': return 'motor';
    case 'hub': return 'hub';
    case 'ball': return 'ball';
    case 'cup': return 'cup';
    case 'bell': return 'bell';
  }
}
/** The frontmost hole under a point on the screen (any layer, the board last), and its layer. */
function holeUnder(px: number, py: number): [number, number, number] | null {
  // (the piece under the finger, where it has got to: its hole there, as built)
  const on = pieceAt(px, py);
  if (on && on.id !== carry?.from) {
    const p = world.pieces[on.id];
    // (a disc only by its hub: its face is wide, and the holes behind it are what's meant)
    const [ox, oy] = p ? poseOf(on.id, p) : [0, 0];
    if (p && isPlanar(p.kind) && (!isDisc(p.kind) || Math.hypot(on.hit[0] - ox, on.hit[1] - oy) < 0.6)) {
      const [dx, dy] = rotXY(on.anchor[0], on.anchor[1], p.rot);
      const f = world.flatAt(p.at[0] + dx, p.at[1] + dy, p.z);
      if (f && f.hole !== 'none') return [p.at[0] + dx, p.at[1] + dy, p.z];
    }
  }
  for (let z = 8; z >= 0; z--) {
    const c = cellAt(px, py, z + 1);
    if (!c) continue;
    const f = world.flatAt(c[0], c[1], z);
    if (f && f.hole !== 'none') return [c[0], c[1], z];
  }
  const c = cellAt(px, py, 0);
  return c && world.inBounds(c[0], c[1]) ? [c[0], c[1], 0] : null;
}
/** Let go: a new piece goes in (and is selected); a moved one stays where it was put. */
function letGo() {
  if (!carry) return;
  const c = carry;
  const g = ghost;
  carry = null;
  ghost = null;
  leanBack(false);
  showWhy('');
  if (c.from < 0) {
    if (!g || g.blocked) {
      popSound();
      showWhy('nowhere to go: back to the tray', 1800);
      return;
    }
    if (g.group) {
      const ids = g.group.filter((p) => world.fits(p)).map((p) => world.add(p));
      history.push({ add: ids });
      clickSound(g.piece);
      select(ids[0] ?? -1);
      showWhy(`${handBuild?.name ?? 'your build'} went on: ${ids.length} pieces`, 2200);
      save();
      rebuild();
      return;
    }
    const ids: number[] = [];
    if (g.extra) ids.push(world.add(g.extra));
    const id = world.add(g.piece);
    ids.push(id);
    for (const pin of g.pins ?? []) if (world.fits(pin)) ids.push(world.add(pin));
    history.push({ add: ids });
    clickSound(g.piece);
    select(id);
    said(g, 'went on');
  } else {
    const from = c.original!;
    if (g && !g.blocked && (g.piece.at[0] !== from.at[0] || g.piece.at[1] !== from.at[1] || g.piece.z !== from.z)) {
      world.restore(c.from, g.piece);
      history.push({ change: c.from, from, to: g.piece });
      clickSound(g.piece);
      select(c.from);
    } else {
      world.restore(c.from, from);
      if (g?.blocked) { popSound(); showWhy('back where it was', 1500); }
    }
  }
  save();
  rebuild();
}
/** What a drop did, said once: the pins it took, the axle it brought, what it meshes with. */
function said(g: { piece: Piece; extra?: Piece; pins?: Piece[]; meshWith?: number }, did: string) {
  const bits: string[] = [];
  if (g.meshWith !== undefined) bits.push(`meshing with the gear ${world.pieces[g.meshWith]?.n}`);
  if (g.pins?.length === 1) bits.push('on one pin, so it turns');
  if (g.pins && g.pins.length >= 2) bits.push('on two pins, held fast');
  if (g.extra) bits.push(g.extra.z === BOARD ? 'on an axle into the board' : 'on an axle');
  showWhy(bits.length ? `${nameOf(g.piece)} ${did}, ${bits.join(', ')}` : '', 2200);
}
/** Swap a placed piece for a changed one, if the change fits; remembered for undo. */
function change(id: number, to: Piece | null): boolean {
  const from = world.pieces[id];
  if (!from || !to) return false;
  world.remove(id);
  if (!world.fits(to)) {
    world.restore(id, from);
    tick(0.5);
    return false;
  }
  world.restore(id, to);
  history.push({ change: id, from, to });
  save();
  rebuild();
  return true;
}
function turn() {
  if (selected < 0) {
    if (handBuild) return;
    handRot = (handRot + 1) % 4;
    tick(1.5);
    return;
  }
  const p = world.pieces[selected]!;
  if (!isPlanar(p.kind) || isDisc(p.kind)) return;
  if (change(selected, world.turned(selected))) clickSound(p);
}
function nudge(dz: number) {
  if (selected < 0) return;
  const p = world.pieces[selected]!;
  if (change(selected, world.nudged(selected, dz))) clickSound(p);
}
function recolour() {
  const b = world.pieces[selected];
  if (!b || (b.kind !== 'beam' && b.kind !== 'crank')) return;
  const i = BEAM_COLOURS.indexOf(b.colour);
  const colour = BEAM_COLOURS[(i + 1) % BEAM_COLOURS.length];
  if (change(selected, { ...b, colour })) tone(note(colour), 0, 0.9, 0.05);
}
function removeSelected() {
  const p = world.remove(selected);
  if (!p) return;
  history.push({ remove: selected, piece: p });
  popSound();
  select(-1);
  save();
  rebuild();
}
function undo() {
  const a = history.pop();
  if (!a) return;
  if ('add' in a) {
    for (const id of a.add) world.remove(id);
    if (a.add.includes(selected)) select(-1);
    popSound();
  } else if ('change' in a) {
    world.remove(a.change);
    world.restore(a.change, a.from);
    popSound();
  } else {
    world.restore(a.remove, a.piece);
    popSound();
  }
  save();
  rebuild();
}

// ─── the view ──────────────────────────────────────────────────────────────────────────────────
let yaw = 0.42;
let pitch = 0.3;
let zoom = preview ? 1.0 : 1.45;
const look: C3 = [BW / 2 - 0.5, BH * 0.3, 1.5];
/** the three views: face on, from above (the layers), along the board; and where the view is going */
const VIEWS: Array<{ name: string; yaw: number; pitch: number }> = [{ name: 'face on', yaw: 0.42, pitch: 0.3 }, { name: 'from above', yaw: 0.2, pitch: 1.0 }, { name: 'along', yaw: 1.1, pitch: 0.25 }];
let viewI = 0;
let goTo: { yaw: number; pitch: number } | null = null;
/** The view leans back while a piece is carried, to show the layers; then comes back. */
function leanBack(on: boolean) {
  if (on) { if (!lean) lean = { yaw, pitch }; goTo = { yaw: Math.max(yaw, 0.55), pitch: Math.max(pitch, 0.62) }; }
  else if (lean) { goTo = lean; lean = null; }
}
let lean: { yaw: number; pitch: number } | null = null;
function easeView(dt: number) {
  if (!goTo) return;
  const k = 1 - Math.exp(-dt * 7);
  yaw += (goTo.yaw - yaw) * k;
  pitch += (goTo.pitch - pitch) * k;
  if (Math.abs(goTo.yaw - yaw) < 0.003 && Math.abs(goTo.pitch - pitch) < 0.003) goTo = null;
}
function camera() {
  const W = canvas.width;
  const Hh = canvas.height;
  const aspect = W / Hh;
  const fov = 0.6;
  const t = Math.tan(fov / 2);
  // (far enough back that the board fits across the window, however narrow)
  const fit = Math.max(BW * 0.9, (BW * 0.56) / (t * aspect));
  const d = fit / zoom;
  const eye: C3 = [
    look[0] + Math.sin(yaw) * Math.cos(pitch) * d,
    look[1] + Math.sin(pitch) * d,
    look[2] + Math.cos(yaw) * Math.cos(pitch) * d,
  ];
  const fwd = normalize(sub(look, eye));
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const shift = trayFrac();
  return { eye, d, fwd, right, up, aspect, fov, shift, vp: viewProj(eye, fwd, right, up, fov, aspect, shift) };
}
let trayPx = 0;
function trayFrac() {
  return innerHeight > 0 ? trayPx / innerHeight : 0;
}
/** how far above a touch the carried piece floats, so the thumb doesn't hide it */
let touchLift = 0;
function ray(px: number, py: number): { o: C3; d: C3 } {
  py -= touchLift;
  const c = camera();
  const r = canvas.getBoundingClientRect();
  const nx = ((px - r.left) / r.width) * 2 - 1;
  const ny = 1 - ((py - r.top) / r.height) * 2 - c.shift;
  const t = Math.tan(c.fov / 2);
  return { o: c.eye, d: normalize([0, 1, 2].map((a) => c.fwd[a] + c.right[a] * nx * t * c.aspect + c.up[a] * ny * t) as C3) };
}
/** Where a point on the screen meets the plane at depth z (in front of the eye). */
function onPlane(px: number, py: number, z: number): V2 | null {
  const { o, d } = ray(px, py);
  if (Math.abs(d[2]) < 1e-6) return null;
  const t = (z - o[2]) / d[2];
  if (t <= 0) return null;
  return [o[0] + d[0] * t, o[1] + d[1] * t];
}
/** The hole grid cell under a point, on a layer's face. */
function cellAt(px: number, py: number, z: number): V2 | null {
  const p = onPlane(px, py, z);
  return p ? [Math.round(p[0]), Math.round(p[1])] : null;
}
/** Where a piece is now: its origin and its turn (built, or as the machine has it). */
function poseOf(id: number, p: Piece): [number, number, number] {
  return sim.pose(id, p.at[0], p.at[1]);
}
/** The piece under a point on the screen, and the hole it was taken by. */
function pieceAt(px: number, py: number): { id: number; anchor: V2; hit: V2; z: number } | null {
  let best: { id: number; anchor: V2; hit: V2; z: number; t: number } | null = null;
  const { o, d } = ray(px, py);
  world.pieces.forEach((p, id) => {
    if (!p) return;
    const [ox, oy, ang] = poseOf(id, p);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const faces = isPlanar(p.kind) ? [p.z + 1] : spanOf(p).map((z) => z + 1).concat([p.z + p.n]);
    for (const z of faces) {
      if (Math.abs(d[2]) < 1e-6) continue;
      const t = (z - o[2]) / d[2];
      if (t <= 0 || (best && t >= best.t)) continue;
      const wx = o[0] + d[0] * t - ox, wy = o[1] + d[1] * t - oy;
      // (in the piece's own frame, as built)
      const lx = c * wx - s * wy, ly = s * wx + c * wy;
      let hit = false;
      let anchor: V2 = [0, 0];
      if (!isPlanar(p.kind)) hit = Math.hypot(lx, ly) <= 0.42;
      else if (isDisc(p.kind)) hit = Math.hypot(lx, ly) <= radiusOf(p);
      else if (p.kind === 'ramp') {
        const [dx, dy] = rotXY(p.n, -(p.m ?? 0), p.rot);
        const l2 = dx * dx + dy * dy;
        const tt = Math.max(0, Math.min(1, (lx * dx + ly * dy) / l2));
        hit = Math.hypot(lx - dx * tt, ly - dy * tt) <= 0.5;
        // (by its nearer end)
        anchor = tt > 0.5 ? [p.n, -(p.m ?? 0)] : [0, 0];
      } else {
        for (const cell of localCells(p.kind, p.n)) {
          const [cx, cy] = rotXY(cell.i, cell.j, p.rot);
          if (Math.abs(lx - cx) <= 0.5 && Math.abs(ly - cy) <= 0.5) { hit = true; anchor = [cell.i, cell.j]; break; }
        }
      }
      if (hit) best = { id, anchor, hit: [o[0] + d[0] * t, o[1] + d[1] * t], z, t };
    }
  });
  return best;
}

// ─── hands ─────────────────────────────────────────────────────────────────────────────────────
type Ptr = {
  x: number; y: number; x0: number; y0: number; t0: number; moved: boolean; button: number; shift: boolean;
  on: { id: number; anchor: V2; hit: V2; z: number } | null;
};
const pointers = new Map<number, Ptr>();
let two: { d: number; a: number; x: number; y: number } | null = null;
/** a finger on the machine as it runs */
let finger: { z: number } | null = null;
let holdTimer = 0;
canvas.addEventListener('pointerdown', (e) => {
  wake();
  closeDrawer();
  canvas.setPointerCapture(e.pointerId);
  touchLift = e.pointerType === 'touch' ? 44 : 0;
  const on = e.button === 0 && !e.shiftKey ? pieceAt(e.clientX, e.clientY + touchLift) : null;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, button: e.button, shift: e.shiftKey, on });
  // (held still on a piece: it lifts, to be moved — no need to pick it first)
  clearTimeout(holdTimer);
  if (on && pointers.size === 1) {
    const id = e.pointerId;
    holdTimer = window.setTimeout(() => {
      const p = pointers.get(id);
      if (!p || p.moved || carry || !p.on || !world.pieces[p.on.id]) return;
      sim.finger = null;
      finger = null;
      select(p.on.id);
      lift(p.on.id, p.on.anchor);
      carryTo(p.x, p.y);
      tick(1.5);
    }, 380);
  }
  if (pointers.size >= 2) {
    if (carry && carry.from >= 0) { ghost = null; letGo(); }
    sim.finger = null;
    finger = null;
  } else if (on && on.id !== selected && !carry) {
    // (a hand on a piece that isn't picked: a soft pull on it, there, as it goes)
    const b = sim.bodyOf(on.id);
    if (b > 0 && (sim.invM[b] || sim.invI[b])) {
      const ca = Math.cos(-sim.a[b]), sa = Math.sin(-sim.a[b]);
      const wx = on.hit[0] - sim.x[b], wy = on.hit[1] - sim.y[b];
      sim.finger = { body: b, lx: ca * wx - sa * wy, ly: sa * wx + ca * wy, tx: on.hit[0], ty: on.hit[1] };
      finger = { z: on.z };
    }
  }
  two = null;
  document.getElementById('hint')?.classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const now = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (two) {
      if (two.d > 0) zoom = clamp(zoom * (now.d / two.d), 0.5, 5);
      slide(now.x - two.x, now.y - two.y);
    }
    two = now;
    for (const q of pointers.values()) q.moved = true;
    return;
  }
  if (sim.finger && finger && !carry) {
    const t = onPlane(e.clientX, e.clientY + touchLift, finger.z);
    if (t) { sim.finger.tx = t[0]; sim.finger.ty = t[1]; }
    if (p.moved) clearTimeout(holdTimer);
    return;
  }
  if (!p.moved) return;
  // on the picked piece: it moves, by the hole it was taken by; anywhere else: the view turns
  if (p.on && p.on.id === selected && !carry) lift(selected, p.on.anchor);
  if (carry && carry.from >= 0) carryTo(e.clientX, e.clientY);
  else if (p.button === 2 || p.shift) slide(dx, dy);
  else orbit(dx, dy);
});
function orbit(dx: number, dy: number) {
  goTo = null;
  yaw = clamp(yaw + dx * 0.006, -1.2, 1.2);
  pitch = clamp(pitch + dy * 0.005, -0.2, 1.2);
}
/** Slide the view over the board with the fingers. */
function slide(dx: number, dy: number) {
  const c = camera();
  const k = (2 * Math.tan(c.fov / 2) * c.d) / canvas.getBoundingClientRect().height;
  look[0] = clamp(look[0] - c.right[0] * dx * k, XMIN, XMAX);
  look[1] = clamp(look[1] + dy * k, -2, BH + 4);
}
canvas.addEventListener('pointerup', (e) => {
  clearTimeout(holdTimer);
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  const pulled = !!sim.finger;
  sim.finger = null;
  finger = null;
  if (carry && carry.from >= 0) return letGo();
  if (!p || p.moved || performance.now() - p.t0 > 600 || p.button === 2) return;
  // a tap: on a piece, pick it (or let it go); on the picked hub, its program; on nothing, let go
  if (p.on && p.on.id === selected && world.pieces[selected]?.kind === 'hub') return openHub();
  void pulled;
  select(p.on && p.on.id !== selected ? p.on.id : -1);
});
canvas.addEventListener('pointercancel', (e) => {
  clearTimeout(holdTimer);
  pointers.delete(e.pointerId);
  two = null;
  sim.finger = null;
  finger = null;
  if (carry && carry.from >= 0) { ghost = null; letGo(); }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 5);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// the tray: a drawer of pieces. Tap one to take it in hand (it goes in the corner); drag one
// (or the one in hand, from its corner) out onto the build
const $ = (id: string) => document.getElementById(id)!;
const drawer = $('drawer');
{
  let html = '';
  for (const g of TRAY_GROUPS) {
    html += `<h3>${g}</h3><div class="tiles">`;
    TRAY.forEach((o, i) => { if (o.group === g) html += `<button class="tile" data-i="${i}">${glyph(o.spec, 56)}<span>${o.label}</span></button>`; });
    html += '</div>';
  }
  $('tiles').innerHTML = html;
}
function showHand() {
  for (const b of drawer.querySelectorAll('.tile')) {
    const el = b as HTMLElement;
    if (el.dataset.b) {
      el.classList.toggle('on', handBuild?.id === el.dataset.b);
      el.classList.toggle('later', !buildsOffered());
      continue;
    }
    const i = Number(el.dataset.i);
    b.classList.toggle('on', !handBuild && i === hand);
    b.classList.toggle('later', !!mission && !mission.tray.includes(TRAY[i].label));
  }
  $('next').textContent = handBuild ? handBuild.name : TRAY[hand].label;
}
const offered = (i: number) => !mission || mission.tray.includes(TRAY[i].label);
const buildsOffered = () => !mission || mission.tray.includes('your builds');
/** Your builds, as tiles in the drawer: each a piece to drag on whole. */
function showBuildTiles() {
  const kept = builds.filter((b) => b.pieces.length);
  $('build-tiles').innerHTML = kept.map((b) => `<button class="tile" data-b="${b.id}">${schematic(b.pieces, 56, 56)}<span>${esc(b.name)}</span></button>`).join('') || '<p class="none">nothing kept yet: `keep` makes one of what\'s on the board</p>';
  showHand();
}
function openDrawer() { drawer.classList.add('on'); tick(1.5); }
function closeDrawer() { drawer.classList.remove('on'); }
let trayPtr: { id: number; x0: number; y0: number; moved: boolean; chip: number; build?: Build } | null = null;
const trayDown = (e: PointerEvent, chip: number, build?: Build) => {
  wake();
  if (carry) return;
  trayPtr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, chip, build };
  document.getElementById('hint')?.classList.remove('on');
};
const trayMove = (e: PointerEvent) => {
  if (!trayPtr || trayPtr.id !== e.pointerId) return;
  const dx = e.clientX - trayPtr.x0, dy = e.clientY - trayPtr.y0;
  if (!trayPtr.moved) {
    if (Math.hypot(dx, dy) < 8) return;
    trayPtr.moved = true;
    touchLift = e.pointerType === 'touch' ? 44 : 0;
    if (trayPtr.build) { handBuild = trayPtr.build; showHand(); closeDrawer(); }
    else if (trayPtr.chip >= 0) { hand = trayPtr.chip; handBuild = null; handRot = 0; showHand(); closeDrawer(); }
    pickUp();
    select(-1);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  carryTo(e.clientX, e.clientY);
};
const trayUp = (e: PointerEvent) => {
  if (!trayPtr || trayPtr.id !== e.pointerId) return;
  const t = trayPtr;
  trayPtr = null;
  if (!t.moved) {
    if (e.type !== 'pointerup') return;
    if (t.build) { handBuild = t.build; showHand(); closeDrawer(); tick(1.5); }
    else if (t.chip >= 0) { hand = t.chip; handBuild = null; handRot = 0; showHand(); closeDrawer(); tick(1.5); save(); }
    else turn();
    return;
  }
  letGo();
};
drawer.addEventListener('pointerdown', (e) => {
  const tile = (e.target as HTMLElement).closest('.tile') as HTMLElement | null;
  if (!tile) return;
  if (tile.dataset.b) {
    if (!buildsOffered()) { showWhy('not in this one: later', 1500); tick(0.5); return; }
    const b = builds.find((x) => x.id === tile.dataset.b);
    if (b) trayDown(e, -1, b);
    return;
  }
  if (!offered(Number(tile.dataset.i))) { showWhy('not in this one: later', 1500); tick(0.5); return; }
  trayDown(e, Number(tile.dataset.i));
});
drawer.addEventListener('pointermove', trayMove);
drawer.addEventListener('pointerup', trayUp);
drawer.addEventListener('pointercancel', trayUp);
const corner = $('next');
corner.addEventListener('pointerdown', (e) => { corner.setPointerCapture(e.pointerId); trayDown(e, -1); });
corner.addEventListener('pointermove', trayMove);
corner.addEventListener('pointerup', trayUp);
corner.addEventListener('pointercancel', trayUp);

// ─── the builds: kept here, each with a name; the start screen shows them, and what to start from
interface Build { id: string; name: string; from: string; pieces: Piece[]; ports: Port[]; savedAt: number }
const BUILDS = 'technic:builds';
let builds: Build[] = [];
let current: string | null = null;
function loadBuilds() {
  try {
    const s = JSON.parse(localStorage.getItem(BUILDS) ?? 'null') as { builds: Build[]; current: string | null } | null;
    if (s) { builds = s.builds ?? []; current = s.current ?? null; }
    // (a build from before there were builds)
    const old = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null;
    if (old && old.pieces && !builds.length) {
      builds.push({ id: 'b' + Date.now().toString(36), name: 'my build', from: 'before', pieces: old.pieces, ports: old.ports ?? [], savedAt: Date.now() });
      localStorage.removeItem(STORE);
    }
  } catch { /* */ }
}
function storeBuilds() {
  if (auto) return;
  try { localStorage.setItem(BUILDS, JSON.stringify({ builds, current })); } catch { /* */ }
}
// ─── the missions: a machine with something missing, a goal to meet
const MISSIONS = missions();
const MSTORE = 'technic:missions';
let mission: Mission | null = null;
let goalDone = false;
let cupT = 0;
let missionsDone = new Set<string>();
let missionWork: Record<string, { pieces: Piece[]; ports: Port[] }> = {};
function loadMissions() {
  try {
    const s = JSON.parse(localStorage.getItem(MSTORE) ?? 'null') as { done: string[]; work: typeof missionWork } | null;
    if (s) { missionsDone = new Set(s.done ?? []); missionWork = s.work ?? {}; }
  } catch { /* */ }
}
function storeMissions() {
  if (auto) return;
  try { localStorage.setItem(MSTORE, JSON.stringify({ done: [...missionsDone], work: missionWork })); } catch { /* */ }
}
function startMission(m: Mission, fresh = false) {
  mission = m;
  goalDone = false;
  world = new World();
  history = [];
  const w = !fresh && missionWork[m.id];
  for (const p of w ? w.pieces : m.pieces) if (world.fits(p)) world.add(p);
  ports = (w ? w.ports : m.ports).map((x) => ({ ...x }));
  current = null;
  select(-1);
  closeStart();
  showTitle();
  showBuildTiles();
  rebuild(false);
  showWhy(`<b>${m.name}</b> · ${m.ask}`, 9000);
}
/** The goals, looked at as it runs: met once, said and kept. */
function checkGoals() {
  if (!mission || goalDone) return;
  const g = mission.goal;
  const m = sim.mech;
  let met = false;
  if (g.kind === 'turn') {
    const b = m.bodyOf[g.piece];
    met = b >= 0 && Math.abs(sim.a[b]) >= Math.PI * 2 * g.turns;
  } else if (g.kind === 'wall') met = ctl.wall < 3;
  else if (g.kind === 'copies') {
    let turning = 0;
    world.pieces.forEach((p, id) => { if (p && p.kind === g.of && p.n === 40 && Math.abs(sim.w[m.bodyOf[id]]) > 0.5) turning++; });
    met = turning >= g.n;
  }
  else if (g.kind === 'bell') met = bellRung;
  else if (g.kind === 'cup') {
    let inCup = false;
    for (const cup of m.cups) {
      const [cx, cy] = sim.point(cup.body, cup.x, cup.y);
      for (const ball of m.balls) {
        if (ball.z !== cup.z) continue;
        const speed = Math.hypot(sim.vx[ball.body], sim.vy[ball.body]);
        if (Math.hypot(sim.x[ball.body] - cx, sim.y[ball.body] - cy) < 1.1 && speed < 0.6) inCup = true;
      }
    }
    cupT = inCup ? cupT + 1 / 60 : 0;
    met = cupT > 0.6;
  }
  if (!met) return;
  goalDone = true;
  missionsDone.add(mission.id);
  storeMissions();
  ding();
  const i = MISSIONS.indexOf(mission);
  const next = MISSIONS[(i + 1) % MISSIONS.length];
  showWhy(`<b>it works!</b> ${mission.name} · <button id="why-next">next: ${next.name}</button>`, 0);
  showBuildTiles();
}
/** A bell is rung by anything that comes to meet it (in its layer): on the touch, not while it rests there. */
let bellRung = false;
const inBell = new Set<string>();
function watchBells() {
  const m = sim.mech;
  m.bells.forEach((bell, bi) => {
    const [bx, by] = sim.point(bell.body, bell.x, bell.y);
    m.contacts.forEach((c, ci) => {
      if (c.body === bell.body || c.z !== bell.z) return;
      const [px, py] = sim.point(c.body, c.x, c.y);
      const key = `${bi}:${ci}`;
      const touching = Math.hypot(px - bx, py - by) < c.r + bell.r;
      if (touching && !inBell.has(key)) { bellSound(); bellRung = true; bellFlash = 1; }
      if (touching) inBell.add(key); else inBell.delete(key);
    });
  });
}
let bellFlash = 0;

const STARTERS: Array<{ from: string; name: string }> = [
  { from: 'empty', name: 'an empty board' },
  { from: 'gears', name: 'a gear train' },
  { from: 'crank', name: 'a crank and rocker' },
  { from: 'car', name: 'a car' },
  { from: 'swing', name: 'pendulums' },
  { from: 'marble', name: 'a marble run' },
];
/** Open a build: it becomes the current one, on the board. */
function openBuild(b: Build) {
  mission = null;
  world = new World();
  history = [];
  for (const p of b.pieces) if (world.fits(p)) world.add(p);
  ports = b.ports.map((x) => ({ ...x }));
  current = b.id;
  select(-1);
  storeBuilds();
  closeStart();
  showTitle();
  showHand();
  rebuild(false);
}
/** A new build from a starter (or nothing). */
function newBuild(from: string) {
  const d = from === 'empty' ? { pieces: [], ports: [] } : demo(from);
  const name = STARTERS.find((s) => s.from === from)?.name ?? from;
  const b: Build = { id: 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name, from, pieces: d.pieces, ports: d.ports, savedAt: Date.now() };
  builds.unshift(b);
  openBuild(b);
  if (from === 'empty') document.getElementById('hint')?.classList.add('on');
}
const when = (t: number) => {
  const d = Date.now() - t;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  if (d < 86400e3) return `${Math.round(d / 3600e3)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function showStart() {
  const mine = builds.map((b) => `<article class="build${b.id === current ? ' current' : ''}" data-id="${b.id}">
    <div class="pic">${b.pieces.length ? schematic(b.pieces, 150, 100, { board: true }) : '<span class="empty">nothing yet</span>'}</div>
    <div class="name">${esc(b.name)}</div><div class="meta">${b.pieces.length} pieces · ${when(b.savedAt)}</div>
    <div class="acts"><button data-act="rename">rename</button><button data-act="forget">forget</button></div>
  </article>`).join('');
  $('mine').innerHTML = mine || '<p class="none">none yet: start from something below</p>';
  $('missions').innerHTML = MISSIONS.map((m) => `<article class="build mission${mission?.id === m.id ? ' current' : ''}${missionsDone.has(m.id) ? ' done' : ''}" data-mission="${m.id}">
    <div class="pic">${schematic(m.pieces, 150, 100, { board: true })}<span class="tick">✓</span></div>
    <div class="name">${esc(m.name)}</div><div class="meta">${esc(m.ask)}</div>
  </article>`).join('');
  $('starters').innerHTML = STARTERS.map((st) => {
    const ps = st.from === 'empty' ? [] : demo(st.from).pieces;
    return `<article class="build starter" data-from="${st.from}"><div class="pic">${ps.length ? schematic(ps, 150, 100, { board: true }) : '<span class="empty">a board, a tray</span>'}</div><div class="name">${st.name}</div></article>`;
  }).join('');
  $('start').classList.add('on');
}
function closeStart() { $('start').classList.remove('on'); }
$('start').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const act = t.closest('button')?.dataset.act;
  const card = t.closest('.build') as HTMLElement | null;
  if (t.id === 'start-close') return closeStart();
  if (!card) return;
  wake();
  if (card.dataset.mission) { const m = MISSIONS.find((x) => x.id === card.dataset.mission); if (m) startMission(m); return; }
  if (card.dataset.from) return newBuild(card.dataset.from);
  const b = builds.find((x) => x.id === card.dataset.id);
  if (!b) return;
  if (act === 'rename') {
    const name = prompt('a name for it', b.name);
    if (name && name.trim()) { b.name = name.trim(); storeBuilds(); showStart(); }
    return;
  }
  if (act === 'forget') {
    const btn = t.closest('button')!;
    if (btn.textContent !== 'sure?') { btn.textContent = 'sure?'; setTimeout(() => { btn.textContent = 'forget'; }, 3000); return; }
    builds = builds.filter((x) => x.id !== b.id);
    if (current === b.id) { current = null; world = new World(); ports = []; history = []; rebuild(false); }
    storeBuilds();
    showStart();
    showHand();
    return;
  }
  openBuild(b);
});
function showTitle() {
  const b = builds.find((x) => x.id === current);
  $('builds').textContent = mission ? mission.name : b ? b.name : 'builds';
}

addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'r') turn();
  else if (k === 'z') undo();
  else if (k === 'c') recolour();
  else if (k === '[') nudge(-1);
  else if (k === ']') nudge(1);
  else if (k === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (k === 'w') rewind();
  else if (k === 'delete' || k === 'backspace') removeSelected();
  else if (k === 'escape') { select(-1); closeHub(); closeDrawer(); closeStart(); }
  else if (k === 'p') openDrawer();
  else if (k === 'n') { handBuild = null; do hand = (hand + 1) % TRAY.length; while (!offered(hand)); handRot = 0; showHand(); }
});

// ─── the buttons ───────────────────────────────────────────────────────────────────────────────
const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
btn('turn', turn);
btn('undo', undo);
btn('nearer', () => nudge(1));
btn('farther', () => nudge(-1));
btn('colour', recolour);
btn('remove', removeSelected);
btn('program', openHub);
btn('pieces', () => (drawer.classList.contains('on') ? closeDrawer() : openDrawer()));
btn('view', () => {
  viewI = (viewI + 1) % VIEWS.length;
  goTo = { yaw: VIEWS[viewI].yaw, pitch: VIEWS[viewI].pitch };
  lean = null;
  $('view').textContent = VIEWS[viewI].name;
  tick(1.5);
});
$('why').addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'why-next' && mission) {
    const i = MISSIONS.indexOf(mission);
    startMission(MISSIONS[(i + 1) % MISSIONS.length]);
    return;
  }
  // ("put it in front": the carried piece tries the next layer out)
  if ((e.target as HTMLElement).id === 'why-front' && carry && ghost) {
    carry.zHint = ghost.piece.z + 1;
    const p = [...pointers.values()][0];
    const t = trayPtr ? null : p;
    if (t) carryTo(t.x, t.y);
    tick();
  }
});
btn('builds', () => ($('start').classList.contains('on') ? closeStart() : showStart()));
btn('run', () => setPlaying(!playing));
btn('rewind', rewind);
btn('keep', () => {
  const ps = world.list();
  if (!ps.length) { showWhy('nothing on the board to keep', 1500); return; }
  const name = (prompt('a name for this piece', `piece ${builds.length + 1}`) ?? '').trim();
  if (!name) return;
  builds.unshift({ id: 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name, from: mission ? `mission:${mission.id}` : 'kept', pieces: ps.map((p) => ({ ...p, at: [...p.at] as V2 })), ports: ports.map((x) => ({ ...x })), savedAt: Date.now() });
  storeBuilds();
  showBuildTiles();
  tone(note(3), 0, 0.8, 0.05);
  showWhy(`kept as <b>${esc(name)}</b>: it's in the drawer, under your builds`, 3000);
});
let armed: { what: string; at: number } | null = null;
/** A button that asks twice (a build is a lot to lose). */
function twice(id: string, label: string, ask: string, f: () => void) {
  btn(id, () => {
    const now = performance.now();
    if (!armed || armed.what !== id || now - armed.at > 3000) {
      armed = { what: id, at: now };
      $(id).textContent = ask;
      setTimeout(() => { if (armed?.what === id) { armed = null; $(id).textContent = label; } }, 3000);
      return;
    }
    armed = null;
    $(id).textContent = label;
    f();
  });
}
twice('again', 'begin again', 'clear it all?', () => {
  world = new World();
  history = [];
  ports = [];
  select(-1);
  save();
  rebuild(false);
});
btn('sound', () => {
  soundOn = !soundOn;
  showSound();
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.3);
});

// ─── the hub's program ─────────────────────────────────────────────────────────────────────────
const hubEl = $('hub');
function openHub() {
  const motors = world.list().filter((p) => p.kind === 'motor').length;
  const rows: string[] = [];
  for (let i = 0; i < Math.max(1, motors); i++) {
    while (ports.length <= i) ports.push(defaultPort());
    const p = ports[i];
    rows.push(`<div class="port" data-i="${i}">
      <div class="row"><b>${String.fromCharCode(65 + i)}</b><span class="what">${i < motors ? 'motor' : 'no motor on this port'}</span><span class="speed">${p.speed}%</span></div>
      <input type="range" min="-100" max="100" value="${p.speed}" aria-label="speed">
      <div class="rules">${RULES.map((r) => `<button data-rule="${r.rule}" class="${r.rule === p.rule ? 'on' : ''}">${RULE_ICONS[r.rule]}<span>${r.label}</span></button>`).join('')}</div>
    </div>`);
  }
  $('ports').innerHTML = rows.join('');
  hubEl.classList.add('on');
  tick(1.5);
}
function closeHub() {
  hubEl.classList.remove('on');
}
hubEl.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const i = Number(t.closest('.port')?.getAttribute('data-i'));
  if (t.type === 'range') {
    ports[i].speed = Number(t.value);
    t.closest('.port')!.querySelector('.speed')!.textContent = `${ports[i].speed}%`;
    save();
  }
});
hubEl.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button');
  if (!t) return;
  e.stopPropagation();
  if (t.id === 'hub-done') return closeHub();
  const rule = t.dataset.rule as Port['rule'] | undefined;
  if (!rule) return;
  const i = Number(t.closest('.port')?.getAttribute('data-i'));
  ports[i].rule = rule;
  for (const b of t.parentElement!.children) b.classList.toggle('on', b === t);
  tick(1.5);
  save();
});
function showReadings() {
  if (!hubEl.classList.contains('on')) return;
  $('readings').textContent = `tilt ${Math.round(ctl.tilt)}° · wall ${ctl.wall.toFixed(1)}${playing ? '' : ' · paused'}`;
  sim.motors.forEach((m, i) => {
    const el = hubEl.querySelector(`.port[data-i="${i}"] .what`);
    const rpm = Math.round((m.omega / (2 * Math.PI)) * 60);
    if (el) el.textContent = rpm ? `turning · ${rpm > 0 ? '↻' : '↺'} ${Math.abs(rpm)} a minute` : 'still';
  });
}
/** The rules, as pictures. */
const RULE_ICONS: Record<string, string> = {
  run: '<svg viewBox="0 0 24 24" width="28" height="28"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 8l5 4-5 4z" fill="currentColor"/></svg>',
  fro: '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 9h13l-3-3M20 15H7l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  walls: '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 4v16M21 4v16" stroke="currentColor" stroke-width="2"/><path d="M7 12h10l-3-3M17 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tilt: '<svg viewBox="0 0 24 24" width="28" height="28"><g transform="rotate(-28 12 14)"><rect x="5" y="9" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9" y="12" width="6" height="3" fill="currentColor"/></g><path d="M3 20h18" stroke="currentColor" stroke-width="1.6"/></svg>',
};

// ─── sound: a click as a pin goes in, a soft tone, the motors' hum ─────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let space: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
function showSound() { $('sound').textContent = soundOn ? 'sound · on' : 'sound · off'; }
showSound();
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.23;
  const fb = ac.createGain();
  fb.gain.value = 0.25;
  const dark = ac.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1800;
  const wet = ac.createGain();
  wet.gain.value = 0.22;
  delay.connect(dark).connect(fb).connect(delay);
  dark.connect(wet).connect(master);
  const input = ac.createGain();
  input.connect(master);
  input.connect(delay);
  space = input;
  noise = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.004));
  hum(true);
}
function tone(freq: number, when: number, dur: number, gain: number) {
  if (!ac || !space) return;
  const t = ac.currentTime + when;
  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [mult, k] of [[1, 1], [2, 0.15]] as const) {
    const o = ac.createOscillator();
    o.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.value = k;
    o.connect(og).connect(env);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  env.connect(space);
}
function snap(freq: number, gain: number) {
  if (!ac || !space || !noise) return;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.value = gain;
  s.connect(bp).connect(g).connect(space);
  s.start();
}
const SCALE = [0, 2, 4, 7, 9];
const note = (step: number) => 196 * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
let lastTick = 0;
function tick(k = 1) {
  if (!ac) return;
  const now = performance.now();
  if (now - lastTick < 60) return;
  lastTick = now;
  snap(5200, 0.05 * k);
}
function clickSound(p: Piece) {
  snap(p.kind === 'pin' || p.kind === 'axle' ? 3200 : 2400, 0.45);
  setTimeout(() => snap(3800, 0.25), 26);
  tone(note(p.colour + Math.floor(p.at[1] / 4)), 0.02, 1.2, 0.06);
}
function popSound() {
  snap(1500, 0.35);
  tone(note(2) / 2, 0, 0.7, 0.04);
}
/** The motors' hum: one voice, its pitch and loudness with how fast they turn. */
let humVoice: { o: OscillatorNode; g: GainNode; f: BiquadFilterNode } | null = null;
function hum(on: boolean) {
  if (!ac || !space) return;
  if (on && !humVoice) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 70;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = ac.createGain();
    g.gain.value = 0;
    o.connect(f).connect(g).connect(space);
    o.start();
    humVoice = { o, g, f };
  } else if (!on && humVoice) {
    const v = humVoice;
    humVoice = null;
    v.g.gain.setTargetAtTime(0, ac.currentTime, 0.08);
    v.o.stop(ac.currentTime + 0.5);
  }
}
function humAt(speed: number) {
  if (!ac || !humVoice) return;
  const s = Math.min(1, Math.abs(speed));
  humVoice.g.gain.setTargetAtTime(s * 0.05, ac.currentTime, 0.05);
  humVoice.o.frequency.setTargetAtTime(60 + 90 * s, ac.currentTime, 0.05);
  humVoice.f.frequency.setTargetAtTime(300 + 500 * s, ac.currentTime, 0.05);
}

/** Balls rolling: a soft rumble that follows how fast they go. */
let rollVoice: { g: GainNode; f: BiquadFilterNode } | null = null;
function rollAt(speed: number) {
  if (!ac || !space || !noise) return;
  if (!rollVoice) {
    const src = ac.createBufferSource();
    const long = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = long.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    src.buffer = long;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 200;
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(space);
    src.start();
    rollVoice = { g, f };
  }
  const s = Math.min(1, speed / 8);
  rollVoice.g.gain.setTargetAtTime(playing ? s * 0.06 : 0, ac.currentTime, 0.08);
  rollVoice.f.frequency.setTargetAtTime(150 + 500 * s, ac.currentTime, 0.08);
}
let lastThud = 0;
function thud(how: number) {
  const now = performance.now();
  if (now - lastThud < 120) return;
  lastThud = now;
  snap(220, Math.min(0.5, how * 30));
}
function ding() {
  for (const [i, f] of [523, 659, 784, 1047].entries()) tone(f, i * 0.09, 0.9, 0.06);
}
function bellSound() {
  tone(1319, 0, 1.6, 0.07);
  tone(1319 * 2.4, 0, 0.5, 0.025);
  snap(4000, 0.2);
}

// ─── drawing ───────────────────────────────────────────────────────────────────────────────────
const SUN = normalize([0.42, 0.78, 0.55]);
const FOG: C3 = [0.9, 0.9, 0.88];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
addEventListener('resize', resize);

/** Every piece as an instance: where it is now, and how it's drawn (whole, see-through, selected). */
function gather() {
  clearCounts();
  const put = (p: Piece, x: number, y: number, ang: number, kind: number) => {
    for (const { m, colour, dull, at } of meshesOf(p)) instance(m, x, y, p.z, ang + restAngle(p), colour, dull && kind === 0 ? 3 : kind, at);
  };
  // (a ball carried or selected: what shares its layer is tinted, since that's what it meets)
  const ballLayer: number = carry?.spec.kind === 'ball' && ghost && !ghost.blocked ? ghost.piece.z : selected >= 0 && world.pieces[selected]?.kind === 'ball' ? world.pieces[selected]!.z : -1;
  world.pieces.forEach((p, id) => {
    if (!p) return;
    const [x, y, ang] = poseOf(id, p);
    const kind = id === selected ? 2 : kin?.pieces.has(id) || (ballLayer >= 0 && p.z === ballLayer && p.kind !== 'ball' && isPlanar(p.kind)) || (p.kind === 'bell' && bellFlash > 0) ? 5 : 0;
    put(p, x, y, ang, kind);
  });
  if (kin) for (const [x, y, z] of kin.joints) { const [jx, jy] = sim.point(sim.bodyOf(selected) > 0 ? sim.bodyOf(selected) : 0, x, y); instance(mesh('dot', () => sphereMesh(0.16)), jx, jy, z - 0.5, 0, [1, 1, 1], 0); }
  flush();
}
/** The piece on its way, see-through, where it would go (drawn after the rest, over it). */
function gatherGhost() {
  clearCounts();
  if (ghost) {
    const kind = ghost.blocked ? 4 : 1;
    const put = (p: Piece) => {
      for (const { m, colour, at } of meshesOf(p)) instance(m, p.at[0], p.at[1], p.z, restAngle(p), colour, kind, at);
    };
    if (ghost.group) for (const p of ghost.group) put(p);
    else put(ghost.piece);
    if (ghost.extra) put(ghost.extra);
    for (const pin of ghost.pins ?? []) put(pin);
    // (a gear carried: its pitch circle, and the one it would mesh with)
    if (ghost.piece.kind === 'gear' && !ghost.blocked) {
      const r = radiusOf(ghost.piece);
      instance(mesh(`ring-${r}`, () => ringMesh(r)), ghost.piece.at[0], ghost.piece.at[1], ghost.piece.z, 0, [1, 1, 1], 1);
      const q = ghost.meshWith !== undefined ? world.pieces[ghost.meshWith] : null;
      if (q) instance(mesh(`ring-${radiusOf(q)}`, () => ringMesh(radiusOf(q))), q.at[0], q.at[1], q.z, 0, [1, 1, 1], 1);
    }
  }
  flush();
}
function setCommon(p: WebGLProgram, cam: ReturnType<typeof camera>) {
  gl.useProgram(p);
  gl.uniformMatrix4fv(u(p, 'uVP'), false, cam.vp);
  gl.uniform3fv(u(p, 'uSun'), SUN);
  gl.uniform3fv(u(p, 'uEye'), cam.eye);
  gl.uniform3fv(u(p, 'uFog'), FOG);
  gl.uniform1f(u(p, 'uNear'), cam.d);
}

/** The piece in hand, turning slowly in its corner above its name. */
function drawNext(W: number, Hh: number) {
  const box = document.getElementById('next')?.getBoundingClientRect();
  if (!box) return;
  const s = Math.round(box.width * dpr);
  const x0 = Math.round(box.left * dpr);
  const y0 = Hh - Math.round(box.top * dpr) - s;
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x0, y0, s, s);
  gl.viewport(x0, y0, s, s);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  clearCounts();
  if (handBuild) {
    // (the whole build, about its middle)
    const ps = handBuild.pieces;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0;
    for (const q of ps) { x0 = Math.min(x0, q.at[0]); y0 = Math.min(y0, q.at[1]); x1 = Math.max(x1, q.at[0]); y1 = Math.max(y1, q.at[1]); z1 = Math.max(z1, q.z + (isPlanar(q.kind) ? 1 : q.n)); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, size = Math.max(x1 - x0, y1 - y0) / 2 + 2;
    for (const q of ps) for (const { m, colour, dull, at } of meshesOf(q)) instance(m, q.at[0] - cx, q.at[1] - cy, q.z - z1 / 2, restAngle(q), colour, dull ? 3 : 0, at);
    flush();
    const a = time * 0.45;
    const r = size * 1.3 + 1.8;
    const eye: C3 = [Math.cos(a) * r, r * 0.55, Math.sin(a) * r];
    const fwd = normalize(sub([0, 0, 0], eye));
    const right = normalize(cross(fwd, [0, 1, 0]));
    gl.uniformMatrix4fv(u(prog, 'uVP'), false, viewProj(eye, fwd, right, cross(right, fwd), 0.62, 1));
    gl.uniform3fv(u(prog, 'uEye'), eye);
    gl.uniform1f(u(prog, 'uPlain'), 1);
    gl.uniform1f(u(prog, 'uShadow'), 0);
    gl.disable(gl.BLEND);
    drawAll();
    gl.uniform1f(u(prog, 'uPlain'), 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, W, Hh);
    return;
  }
  const spec = handSpec();
  const p: Piece = { ...spec, at: [0, 0], z: 0 };
  // (held by its middle)
  let cx = 0, cy = 0, cz = 0.5, size = 1;
  if (isPlanar(p.kind) && !isDisc(p.kind)) {
    const cs = cellsOf(p);
    cx = cs.reduce((a, c) => a + c.x, 0) / cs.length;
    cy = cs.reduce((a, c) => a + c.y, 0) / cs.length;
    size = Math.max(...cs.map((c) => Math.hypot(c.x - cx, c.y - cy))) + 0.5;
    if (p.kind === 'ramp') { const [dx, dy] = rotXY(p.n, -(p.m ?? 0), p.rot); cx = dx / 2; cy = dy / 2; size = rampLength(p) / 2 + 0.5; }
  } else if (isDisc(p.kind)) size = radiusOf(p);
  else { cz = p.n / 2; size = p.n / 2; }
  for (const { m, colour, dull, at } of meshesOf(p)) instance(m, -cx, -cy, -cz, restAngle(p), colour, dull ? 3 : 0, at);
  flush();
  const a = time * 0.45;
  const r = size * 1.3 + 1.8;
  const eye: C3 = [Math.cos(a) * r, r * 0.55, Math.sin(a) * r];
  const fwd = normalize(sub([0, 0, 0], eye));
  const right = normalize(cross(fwd, [0, 1, 0]));
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, viewProj(eye, fwd, right, cross(right, fwd), 0.62, 1));
  gl.uniform3fv(u(prog, 'uEye'), eye);
  gl.uniform1f(u(prog, 'uPlain'), 1);
  gl.uniform1f(u(prog, 'uShadow'), 0);
  gl.disable(gl.BLEND);
  drawAll();
  gl.uniform1f(u(prog, 'uPlain'), 0);
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, W, Hh);
}

let last = performance.now();
let time = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  resize();
  if (auto) yaw = 0.3 + 0.25 * Math.sin(time * 0.12);
  else easeView(dt);
  // the machine: fixed steps, however the frames come
  if (playing) {
    simLag = Math.min(simLag + dt, 0.1);
    while (simLag >= 1 / 60) {
      simLag -= 1 / 60;
      ctl.update(sim, 1 / 60);
      sim.step(1 / 60);
    }
    let fastest = 0;
    for (const m of sim.motors) fastest = Math.max(fastest, Math.abs(m.omega) / (TURNS * 2 * Math.PI));
    humAt(fastest);
    let rolling = 0;
    for (const b of sim.balls) rolling = Math.max(rolling, Math.hypot(sim.vx[b.body], sim.vy[b.body]));
    rollAt(rolling);
    if (sim.landed > 0.004) thud(sim.landed);
    watchBells();
    checkGoals();
    showReadings();
  }
  bellFlash = Math.max(0, bellFlash - dt * 2);
  gather();

  const cam = camera();
  const W = canvas.width;
  const Hh = canvas.height;
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(skyProg);
  gl.uniform3f(u(skyProg, 'uTop'), 0.74, 0.8, 0.87);
  gl.uniform3f(u(skyProg, 'uLow'), FOG[0], FOG[1], FOG[2]);
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // the board and the floor
  gl.enable(gl.DEPTH_TEST);
  setCommon(flatProg, cam);
  gl.uniform1f(u(flatProg, 'uXMin'), XMIN);
  gl.uniform1f(u(flatProg, 'uXMax'), XMAX);
  gl.bindVertexArray(flatVao);
  gl.uniform1f(u(flatProg, 'uWhich'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.uniform1f(u(flatProg, 'uWhich'), 1);
  gl.drawArrays(gl.TRIANGLES, 6, 6);
  // while a piece is carried: the layers as sheets of glass, the one it lands in lit
  if (carry) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const top = Math.max(2, world.list().reduce((m, p) => Math.max(m, isPlanar(p.kind) ? p.z + 1 : p.z + p.n), 0) + 1);
    const landing = ghost && !ghost.blocked ? (isPlanar(ghost.piece.kind) ? ghost.piece.z : -1) : -1;
    gl.uniform1f(u(flatProg, 'uWhich'), 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, flatBuf);
    for (let z = 0; z < top; z++) {
      const zf = z + 1;
      const x0 = -0.5, x1 = BW - 0.5, y0 = -0.5, y1 = BH - 0.5;
      gl.bufferSubData(gl.ARRAY_BUFFER, 12 * 4 * 3, new Float32Array([x0, y0, zf, x1, y0, zf, x1, y1, zf, x0, y0, zf, x1, y1, zf, x0, y1, zf]));
      gl.uniform1f(u(flatProg, 'uWhich'), z === landing ? 3 : 2);
      gl.drawArrays(gl.TRIANGLES, 12, 6);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // the pieces
  setCommon(prog, cam);
  gl.uniform1f(u(prog, 'uTime'), time);
  gl.uniform1f(u(prog, 'uPlain'), 0);
  gl.uniform1f(u(prog, 'uShadow'), 0);
  gl.uniform1f(u(prog, 'uFloor'), FLOOR + 0.004);
  gl.uniform1f(u(prog, 'uBoard'), 0.004);
  drawAll();
  // their shadows, thrown onto the floor and onto the board (once per place: the stencil keeps count)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enable(gl.STENCIL_TEST);
  gl.stencilFunc(gl.EQUAL, 0, 0xff);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
  gl.uniform1f(u(prog, 'uShadow'), 1);
  drawAll();
  gl.clear(gl.STENCIL_BUFFER_BIT);
  gl.uniform1f(u(prog, 'uShadow'), 2);
  drawAll();
  gl.disable(gl.STENCIL_TEST);
  gl.uniform1f(u(prog, 'uShadow'), 0);
  // the piece on its way: see-through, over the rest
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gatherGhost();
  drawAll();
  gl.depthMask(true);
  if (!auto) drawNext(W, Hh);
  gl.bindVertexArray(null);
  /** (for the devtools: where a point of the world is on the screen) */
  const probe = (x: number, y: number, z: number): [number, number] => {
    const v = cam.vp;
    const cx = v[0] * x + v[4] * y + v[8] * z + v[12], cy = v[1] * x + v[5] * y + v[9] * z + v[13], cw = v[3] * x + v[7] * y + v[11] * z + v[15];
    const r = canvas.getBoundingClientRect();
    return [r.left + ((cx / cw + 1) / 2) * r.width, r.top + ((1 - cy / cw) / 2) * r.height];
  };
  (window as unknown as { __technic: unknown }).__technic = {
    probe,
    pieces: world.count(), playing, ghost: ghost?.piece ?? null, hand: handBuild ? handBuild.name : TRAY[hand].label, selected, sel: world.pieces[selected] ?? null, carrying: !!carry, undo: history.length,
    drawer: drawer.classList.contains('on'), start: $('start').classList.contains('on'), mission: mission?.id ?? null, goalDone, why: $('why').textContent, blocked: ghost?.blocked ?? null, view: VIEWS[viewI].name, builds: builds.map((b) => ({ id: b.id, name: b.name, pieces: b.pieces.length })), current,
    list: world.pieces, motion: sim.motion(), poses: world.pieces.map((p, id) => (p ? poseOf(id, p) : null)), tilt: ctl.tilt, wall: ctl.wall, ports,
  };
  requestAnimationFrame(frame);
}

// ─── small maths ───────────────────────────────────────────────────────────────────────────────
function sub(a: C3, b: C3): C3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: C3, b: C3): C3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a: C3): C3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function viewProj(eye: C3, f: C3, r: C3, up: C3, fov: number, aspect: number, shift = 0): Float32Array {
  const dot = (a: C3, b: C3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z: C3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dot(r, eye), -dot(up, eye), -dot(z, eye), 1];
  const t = 1 / Math.tan(fov / 2);
  const near = 0.2;
  const far = 600;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, -shift, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[c * 4 + rr] = proj[rr] * view[c * 4] + proj[4 + rr] * view[c * 4 + 1] + proj[8 + rr] * view[c * 4 + 2] + proj[12 + rr] * view[c * 4 + 3];
  return out;
}
function measureTray() {
  const el = document.getElementById('tray');
  trayPx = !auto && el ? el.getBoundingClientRect().height : 0;
}
addEventListener('resize', measureTray);

resize();
load();
measureTray();
showBuildTiles();
showRun();
requestAnimationFrame(frame);
