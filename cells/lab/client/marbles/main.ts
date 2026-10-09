/**
 * Marble Run: a race down a run of boards that goes on for as long as you build it.
 *
 * Twelve marbles of glass, steel, wood and rubber wait in a row behind a gate at the top of a
 * wide, sloping board; the gate lifts and they go, down board after board of obstacles (pegs,
 * deflectors, splitters, chicanes, spinners, funnels, gates, bumpers, steps, zigzags), bumping
 * and parting, to a chequered line. A chase camera follows yours. Past the line is build mode:
 * three boards on offer (and three more), from the seed and where you are; pick one and the
 * run grows downward. The run is its seed and your choices, in the address, so a run can be
 * shared and is the same run for anyone.
 *
 * The track (`track.ts`) and the solver (`physics.ts`) are pure and tested on their own; the
 * meshes (`mesh.ts`) too. Here is the drawing (WebGL2: the sun's shadow map, materials: painted
 * wood, glass that refracts and glints, steel that mirrors the sky, wood with a grain, rubber
 * that doesn't shine), the camera, the race and the building, and the sounds.
 */
import { seeded } from '../kit/rng';
import { Course, MATERIALS, marble, order, step, type Impact, type Marble, type Material } from './physics';
import { boardMesh, gateMesh, groundMesh, lineMesh, sphereMesh, spinnerMesh, towerMesh, VSTRIDE } from './mesh';
import { TOP, WIDTH, add, build, candidates, cross, decode, dirOf, encode, len, mul, norm, sub, type Section, type V3 } from './track';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const auto = preview || params.has('auto');
const STORE = 'marbles:v1';

const canvas = document.getElementById('run') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (auto) document.body.classList.add('preview');
const $ = (id: string) => document.getElementById(id)!;

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform vec3 uTop, uLow;
uniform mat4 uInvVP;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // the sky by the view ray: pale at the horizon, deeper up
  vec4 w = uInvVP * vec4(vUV * 2. - 1., 1., 1.);
  vec3 d = normalize(w.xyz / w.w);
  float up = clamp(d.y, -1., 1.);
  vec3 c = mix(uLow, uTop, smoothstep(-.05, .6, up));
  c = mix(c, vec3(.78, .8, .82), smoothstep(0., -.4, up));
  o = vec4(c + (h(gl_FragCoord.xy) - .5) / 255., 1.);
}`;

/** the sun's depth, from above */
const SHADOW_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.); }`;

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in float aMat;
uniform mat4 uVP, uModel, uLightVP;
uniform mat3 uNormal;
out vec3 vWorld;
out vec3 vNor;
out vec3 vLocal;
out vec4 vShadow;
flat out float vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.);
  vWorld = w.xyz;
  vLocal = aPos;
  vNor = normalize(uNormal * aNor);
  vMat = aMat;
  vShadow = uLightVP * w;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vLocal;
in vec4 vShadow;
flat in float vMat; // 0 the board's floor, 1 a wall, 2 metal, 3 ground, 4 tower, 5 the chequered line; 10 glass, 11 steel, 12 wood, 13 rubber (a marble)
out vec4 o;
uniform sampler2D uShadowMap;
uniform vec3 uSun, uEye, uFog, uSkyTop, uSkyLow, uTint;
uniform float uCut;
uniform float uTime, uGhost, uFar;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float a = hash3(i), b = hash3(i + vec3(1, 0, 0)), c = hash3(i + vec3(0, 1, 0)), d = hash3(i + vec3(1, 1, 0));
  float e = hash3(i + vec3(0, 0, 1)), g = hash3(i + vec3(1, 0, 1)), h = hash3(i + vec3(0, 1, 1)), k = hash3(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float shadow(vec3 n) {
  vec3 s = vShadow.xyz / vShadow.w * .5 + .5;
  if (s.x < 0. || s.x > 1. || s.y < 0. || s.y > 1. || s.z > 1.) return 1.;
  float bias = max(.0012 * (1. - dot(n, uSun)), .0004);
  float lit = 0.;
  vec2 px = 1. / vec2(textureSize(uShadowMap, 0));
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    float d = texture(uShadowMap, s.xy + vec2(x, y) * px).r;
    lit += s.z - bias > d ? 0. : 1.;
  }
  return lit / 9.;
}
vec3 sky(vec3 d) {
  vec3 c = mix(uSkyLow, uSkyTop, smoothstep(-.05, .6, d.y));
  c = mix(c, vec3(.55, .5, .42), smoothstep(0., -.5, d.y));
  // the sun's glare in the reflection
  c += vec3(1., .95, .85) * pow(max(dot(d, uSun), 0.), 180.) * 3.;
  return c;
}
void main() {
  // (the walls and pegs right against the camera are cut away, so the chase is never inside one; the floor stays)
  if (vMat > .5 && vMat < 4.5 && uGhost < .5 && length(vWorld - uEye) < uCut) discard;
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  float ndl = max(dot(n, uSun), 0.);
  float sh = shadow(n);
  vec3 base; float rough = .6, metal = 0., alpha = 1.;
  if (vMat < .5) {
    // cardboard: tan, a little mottled, flat
    float g = noise(vWorld * .9) * .5 + noise(vWorld * 5.) * .2;
    base = mix(vec3(.78, .64, .44), vec3(.68, .54, .36), g);
    rough = .85;
  } else if (vMat < 1.5) {
    // a wall: cardboard on edge, lighter, with the flute's stripes
    float stripe = smoothstep(.35, .65, fract(dot(vWorld, vec3(.7, .0, .7)) * 1.6)) * .12;
    base = vec3(.84, .72, .52) - stripe; rough = .8;
  } else if (vMat < 2.5) {
    base = vec3(.6, .62, .65); rough = .35; metal = 1.;
  } else if (vMat < 3.5) {
    // the ground, far below: fields, fading into the haze
    float g = noise(vWorld * .02) * .5 + noise(vWorld * .08) * .3;
    base = mix(vec3(.55, .6, .42), vec3(.66, .66, .56), g); rough = .9;
  } else if (vMat < 4.5) {
    base = vec3(.5, .48, .45); rough = .8;
  } else if (vMat < 5.5) {
    // the line: chequered
    float cx = floor(vLocal.x / 2.), cz = floor(vLocal.z / 2.);
    base = mod(cx + cz, 2.) < .5 ? vec3(.95) : vec3(.08); rough = .7;
  } else if (vMat < 10.5) {
    // glass: a tinted swirl inside, the sky through and off it
    float sw = noise(vLocal * 3. + vec3(1.7, 0., 0.)) ;
    float band = smoothstep(.35, .5, sw) * (1. - smoothstep(.5, .65, sw));
    base = mix(uTint, vec3(1.), .25) * (.6 + .4 * band);
    rough = .08; alpha = .55 + .45 * band;
  } else if (vMat < 11.5) {
    base = vec3(.8, .8, .82); rough = .12; metal = 1.;
  } else if (vMat < 12.5) {
    float g = noise(vLocal * vec3(8., 1.2, 8.)) * .6 + noise(vLocal * 20.) * .2;
    base = mix(vec3(.78, .58, .34), vec3(.5, .33, .18), g); rough = .7;
  } else {
    base = vec3(.16, .16, .17); rough = .85;
  }
  // light: the sun, in or out of shadow; the sky from above; the ground's bounce
  vec3 R = reflect(-V, n);
  // (the sky from above, the ground's warm bounce from below; sides get a fair share)
  vec3 amb = mix(vec3(.42, .38, .34), sky(vec3(0., 1., 0.)) * .8, .5 + .5 * n.y) * .95;
  vec3 diffuse = base * (1. - metal) * (amb + vec3(1., .96, .9) * ndl * 1.25 * sh);
  vec3 F0 = mix(vec3(.04), base, metal);
  float fres = pow(1. - max(dot(n, V), 0.), 5.);
  vec3 F = F0 + (1. - F0) * fres;
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(n, H), 0.), mix(600., 12., rough)) * (1. - rough * .7);
  vec3 refl = sky(R) * mix(.5, 1., 1. - rough) ;
  vec3 c = diffuse + F * (refl * (1. - rough * .85) + vec3(1., .96, .9) * spec * sh * 2.);
  if (vMat > 9.5 && vMat < 10.5) {
    // (through the glass: the sky bent a little, tinted)
    vec3 T = refract(-V, n, .72);
    c = mix(sky(T) * uTint * .9, c, alpha);
  }
  float d = length(vWorld - uEye);
  c = mix(c, uFog, smoothstep(uFar * .35, uFar, d));
  if (vMat > 2.5 && vMat < 3.5) c = mix(c, uFog, smoothstep(60., 400., d) * .75);
  if (uGhost > .5) { c = mix(c, vec3(1., .95, .7), .5); o = vec4(c * .55, .55); return; }
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
const shadowProg = program(SHADOW_VS, SHADOW_FS);
const prog = program(VS, FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── meshes on the card ──────────────────────────────────────────────────────────────────────────
interface Mesh { vao: WebGLVertexArrayObject; svao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number; dynamic: boolean }
function upload(verts: number[] | Float32Array, dynamic = false, into?: Mesh): Mesh {
  const data = verts instanceof Float32Array ? verts : new Float32Array(verts);
  if (into) {
    gl.bindBuffer(gl.ARRAY_BUFFER, into.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    into.count = data.length / VSTRIDE;
    return into;
  }
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  const make = (p: WebGLProgram, attrs: Array<[string, number, number]>) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size, off] of attrs) {
      const loc = gl.getAttribLocation(p, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, VSTRIDE * 4, off * 4);
    }
    gl.bindVertexArray(null);
    return vao;
  };
  return { vao: make(prog, [['aPos', 3, 0], ['aNor', 3, 3], ['aMat', 1, 6]]), svao: make(shadowProg, [['aPos', 3, 0]]), buf, count: data.length / VSTRIDE, dynamic };
}
function drop(m: Mesh) {
  gl.deleteBuffer(m.buf);
  gl.deleteVertexArray(m.vao);
  gl.deleteVertexArray(m.svao);
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────────
let seed = 0;
let choices: number[] = [];
let sections: Section[] = [];
let course!: Course;
/** each section's mesh, the finish's, the tower's and the ground's */
const sectionMeshes: Mesh[] = [];
let finishMesh: Mesh | null = null;
const gateMesh_ = upload(new Float32Array(0), true);
let towerMesh_: Mesh | null = null;
let groundMesh_: Mesh | null = null;
let groundY = 0;
const SPHERE = upload((() => { const v: number[] = []; sphereMesh(v); return v; })());
const barMesh_ = upload(new Float32Array(0), true);
const ghostMeshes: Mesh[] = [];

function meshOf(s: Section): Mesh {
  const v: number[] = [];
  for (const b of s.boards) boardMesh(b, v);
  return upload(v);
}
function rebuildCourse() {
  sections = build(seed, choices);
  course = new Course(sections, TOP);
  while (sectionMeshes.length > sections.length) drop(sectionMeshes.pop()!);
  for (let i = sectionMeshes.length; i < sections.length; i++) sectionMeshes.push(meshOf(sections[i]));
  if (finishMesh) drop(finishMesh);
  const fv: number[] = [];
  boardMesh(course.fin.catchBoard, fv);
  lineMesh(course.fin.line, WIDTH, fv);
  finishMesh = upload(fv);
  // the ground: well below the line, and the tower from it
  groundY = course.fin.line.p[1] - 140;
  if (groundMesh_) drop(groundMesh_);
  const gv: number[] = [];
  groundMesh([TOP.p[0], 0, TOP.p[2]], groundY, 4000, gv);
  groundMesh_ = upload(gv);
  if (towerMesh_) drop(towerMesh_);
  const tv: number[] = [];
  towerMesh(TOP.p, groundY, tv);
  towerMesh_ = upload(tv);
  save();
}
function save() {
  if (auto) return;
  try { localStorage.setItem(STORE, JSON.stringify({ seed, choices, mine, follow })); } catch { /* */ }
  history.replaceState(null, '', `?${encode(seed, choices)}${mine ? `&marble=${mine}` : ''}`);
  $('seed').textContent = `run ${seed} · ${sections.length} section${sections.length === 1 ? '' : 's'}`;
}

// ─── the marbles ──────────────────────────────────────────────────────────────────────────────────
const FIELD: Array<{ mat: number; r: number; name: string; tint: V3 }> = [
  { mat: 0, r: 0.8, name: 'blue', tint: [0.3, 0.6, 0.95] },
  { mat: 1, r: 0.9, name: 'steel', tint: [0.8, 0.8, 0.82] },
  { mat: 2, r: 1.0, name: 'wood', tint: [0.7, 0.5, 0.3] },
  { mat: 3, r: 1.0, name: 'rubber', tint: [0.2, 0.2, 0.2] },
  { mat: 0, r: 0.85, name: 'green', tint: [0.3, 0.85, 0.45] },
  { mat: 0, r: 0.75, name: 'red', tint: [0.95, 0.35, 0.3] },
  { mat: 0, r: 0.8, name: 'amber', tint: [0.95, 0.7, 0.25] },
  { mat: 0, r: 0.8, name: 'violet', tint: [0.6, 0.4, 0.9] },
  { mat: 0, r: 0.85, name: 'teal', tint: [0.2, 0.75, 0.75] },
  { mat: 1, r: 0.8, name: 'steel · small', tint: [0.7, 0.7, 0.74] },
  { mat: 0, r: 0.9, name: 'clear', tint: [0.85, 0.9, 0.95] },
  { mat: 0, r: 0.8, name: 'pink', tint: [0.95, 0.5, 0.7] },
];
let marbles: Marble[] = FIELD.map((f) => marble(f.name, MATERIALS[f.mat], f.r, f.tint));
/** yours: the one the camera follows (its name), or the leader */
let mine = 'blue';
let follow: 'mine' | 'leader' = 'mine';
let raceTime = 0;
let racing = false;
let impacts: Impact[] = [];
/** the race began from this section (0: the top) */
let fromSection = 0;
function release(from = 0) {
  fromSection = from;
  marbles.forEach((m, i) => course.place(m, from, i));
  raceTime = 0;
  racing = true;
  mode('race');
  tick(1.5);
}
/** whether the gate still holds them (the first moments of a race from the top) */
const held = () => racing && fromSection === 0 && raceTime < 0.35;
function followed(): Marble {
  if (follow === 'leader') return order(marbles)[0];
  return marbles.find((m) => m.name === mine) ?? marbles[0];
}

// ─── building ─────────────────────────────────────────────────────────────────────────────────────
let page = 0;
let offered: Section[] = [];
let chosen = -1;
function offer(p = page) {
  page = p;
  offered = candidates(seed, sections.length, sections, page);
  while (ghostMeshes.length) drop(ghostMeshes.pop()!);
  for (const s of offered) ghostMeshes.push(meshOf(s));
  chosen = 0;
  $('offers').innerHTML = offered.map((s, i) => `<button class="offer${i === chosen ? ' on' : ''}" data-i="${i}"><b>${s.name}</b><span>down ${Math.round(s.drop)} · along ${Math.round(s.length)}</span></button>`).join('') + `<button id="more">three more</button>`;
}
function choose(i: number) {
  chosen = i;
  for (const b of $('offers').querySelectorAll('.offer')) b.classList.toggle('on', Number((b as HTMLElement).dataset.i) === i);
  tick();
}
function addChosen() {
  if (chosen < 0 || !offered[chosen]) return;
  choices.push(page * 3 + chosen);
  rebuildCourse();
  clickSound();
  offer(0);
  flyToEnd();
}
function undoSection() {
  if (!choices.length) return;
  choices.pop();
  rebuildCourse();
  popSound();
  offer(0);
  flyToEnd();
}
let view: 'race' | 'build' = 'race';
function mode(v: 'race' | 'build') {
  view = v;
  document.body.classList.toggle('building', v === 'build');
  if (v === 'build') { racing = false; offer(0); flyToEnd(); }
}

// ─── the camera ─────────────────────────────────────────────────────────────────────────────────
const eye: V3 = [0, 420, -40];
const look: V3 = [0, 400, 0];
let camYaw = 0;
let camPitch = 0.8;
let orbit = { yaw: 0, pitch: 0 };
let zoom = 1;
let flyTarget: { eye: V3; look: V3 } | null = null;
function flyToEnd() {
  const end = sections.length ? sections[sections.length - 1].end : TOP;
  const d = dirOf(end.yaw, 0);
  const l: V3 = add(end.p, mul(d, 40));
  flyTarget = { eye: add(add(end.p, mul(d, -50)), [0, 55, 0]), look: l };
}
function updateCamera(dt: number) {
  if (view === 'build' && flyTarget) {
    const k = 1 - Math.exp(-dt * 2.5);
    for (let i = 0; i < 3; i++) { eye[i] += (flyTarget.eye[i] - eye[i]) * k; look[i] += (flyTarget.look[i] - look[i]) * k; }
    return;
  }
  const m = followed();
  // the board's way (the run is straight down it), the camera behind and above
  const speed = len(m.v);
  const sec = sections[Math.min(m.sec, sections.length - 1)];
  const fwd: V3 = sec ? sec.boards[0].frame.t : dirOf(TOP.yaw, TOP.pitch);
  const targetYaw = Math.atan2(fwd[0], fwd[2]);
  // (turn the camera's heading toward the marble's, smoothly round the circle)
  let dy = targetYaw - camYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  camYaw += dy * (1 - Math.exp(-dt * 2.2));
  const yaw = camYaw + orbit.yaw;
  const pitch = camPitch + orbit.pitch;
  const dist = (38 + Math.min(12, speed * 0.03)) / zoom;
  const back: V3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  // (over the middle of the board, so the whole field is in view)
  const bf = sec ? sec.boards[0].frame : null;
  const mid = bf ? add(m.p, mul(bf.b, -dotv(sub(m.p, bf.p), bf.b) * 0.6)) : m.p;
  const wantEye = add(mid, mul(back, dist));
  const wantLook = add(mid, mul(fwd, 10));
  const k = 1 - Math.exp(-dt * 6);
  for (let i = 0; i < 3; i++) { eye[i] += (wantEye[i] - eye[i]) * k; look[i] += (wantLook[i] - look[i]) * (1 - Math.exp(-dt * 10)); }
  // (the orbit a finger gave decays back behind)
  orbit.yaw *= Math.exp(-dt * 0.8);
  orbit.pitch *= Math.exp(-dt * 0.8);
}

// ─── hands ──────────────────────────────────────────────────────────────────────────────────────
const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; moved: boolean }>();
let two: { d: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
  two = null;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (two && two.d > 0) zoom = Math.max(0.5, Math.min(3, zoom * (d / two.d)));
    two = { d };
    return;
  }
  if (!p.moved) return;
  if (view === 'build' && flyTarget) {
    // (in build: turn about the end)
    const end = sections.length ? sections[sections.length - 1].end : TOP;
    const rel = sub(flyTarget.eye, end.p);
    const yaw = Math.atan2(rel[0], rel[2]) + dx * 0.006;
    const r = Math.hypot(rel[0], rel[2]);
    flyTarget.eye = [end.p[0] + Math.sin(yaw) * r, Math.max(end.p[1] + 8, flyTarget.eye[1] + dy * 0.3), end.p[2] + Math.cos(yaw) * r];
    return;
  }
  orbit.yaw = Math.max(-2.5, Math.min(2.5, orbit.yaw - dx * 0.006));
  orbit.pitch = Math.max(-0.4, Math.min(0.9, orbit.pitch + dy * 0.005));
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  if (p && !p.moved && e.type === 'pointerup' && view === 'race') {
    // a tap: follow the next marble
    const i = marbles.findIndex((m) => m.name === mine);
    mine = marbles[(i + 1) % marbles.length].name;
    follow = 'mine';
    showFollow();
    save();
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(3, zoom * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });

const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
btn('race', () => release(0));
btn('here', () => release(Math.max(0, sections.length - 1)));
btn('build', () => mode(view === 'build' ? 'race' : 'build'));
btn('add', addChosen);
btn('undo', undoSection);
btn('follow', () => { follow = follow === 'mine' ? 'leader' : 'mine'; showFollow(); save(); });
btn('new', () => { seed = Math.floor(Math.random() * 90000) + 1; choices = []; rebuildCourse(); page = 0; release(0); });
$('offers').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#more')) { offer(page + 1); tick(1.5); return; }
  const b = t.closest('.offer') as HTMLElement | null;
  if (b) choose(Number(b.dataset.i));
});
function showFollow() {
  $('follow').textContent = follow === 'leader' ? 'following the leader' : `following ${mine}`;
}
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); release(0); }
  else if (k === 'b') mode(view === 'build' ? 'race' : 'build');
  else if (k === 'enter' && view === 'build') addChosen();
  else if (k === 'z' && view === 'build') undoSection();
  else if (k === 'f') { follow = follow === 'mine' ? 'leader' : 'mine'; showFollow(); }
  else if (k === '1' || k === '2' || k === '3') { if (view === 'build') choose(Number(k) - 1); }
});
btn('sound', () => {
  soundOn = !soundOn;
  showSound();
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.3);
});

// ─── sound: the roll, the knocks, the wind of the drop ────────────────────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
function showSound() { $('sound').textContent = soundOn ? 'sound · on' : 'sound · off'; }
showSound();
let roll: { g: GainNode; f: BiquadFilterNode } | null = null;
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 300;
  const g = ac.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  roll = { g, f };
}
function rollAt(speed: number, on: boolean) {
  if (!ac || !roll) return;
  const s = Math.min(1, speed / 300);
  roll.g.gain.setTargetAtTime(on ? s * 0.08 : 0, ac.currentTime, 0.06);
  roll.f.frequency.setTargetAtTime(200 + 900 * s, ac.currentTime, 0.06);
}
function knock(mat: Material, j: number, other: Material | null) {
  if (!ac || !master || !noise) return;
  const t = ac.currentTime;
  const loud = Math.min(0.5, j * 0.004);
  // each material its own voice: glass rings, steel clacks, wood thocks, rubber thuds
  const f = other ? (mat.look === 'glass' || other.look === 'glass' ? 3200 : 1800) : mat.look === 'glass' ? 2600 : mat.look === 'steel' ? 2000 : mat.look === 'wood' ? 900 : 260;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = mat.look === 'rubber' ? 1.5 : 6;
  const g = ac.createGain();
  g.gain.setValueAtTime(loud, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (mat.look === 'glass' ? 0.12 : 0.05));
  s.connect(bp).connect(g).connect(master);
  s.start(t);
  s.stop(t + 0.15);
  if (mat.look === 'glass' || mat.look === 'steel') {
    const o = ac.createOscillator();
    o.frequency.value = mat.look === 'glass' ? 4200 : 3000;
    const og = ac.createGain();
    og.gain.setValueAtTime(loud * 0.3, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + 0.12);
  }
}
let lastTick = 0;
function tick(k = 1) {
  if (!ac || !master || !noise) return;
  const now = performance.now();
  if (now - lastTick < 60) return;
  lastTick = now;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.04 * k, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.03);
  s.connect(bp).connect(g).connect(master);
  s.start(); s.stop(ac.currentTime + 0.05);
}
function clickSound() { knock(MATERIALS[2], 60, null); }
function popSound() { knock(MATERIALS[3], 60, null); }

// ─── drawing ────────────────────────────────────────────────────────────────────────────────────
const SUN = norm([0.45, 0.8, 0.35]);
const FOG: V3 = [0.86, 0.88, 0.9];
const SKY_TOP: V3 = [0.36, 0.56, 0.86];
const SKY_LOW: V3 = [0.82, 0.86, 0.9];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
addEventListener('resize', resize);
// the shadow map
const SHADOW = preview ? 1024 : 2048;
const shadowTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, shadowTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const shadowFb = gl.createFramebuffer()!;
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const skyVao = gl.createVertexArray()!;

const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const I3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
/** a marble's model matrix: its turn and place, its size */
function marbleModel(m: Marble): [Float32Array, Float32Array] {
  const [x, y, z, w] = m.q;
  const r = m.r;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  const M = new Float32Array([R[0] * r, R[1] * r, R[2] * r, 0, R[3] * r, R[4] * r, R[5] * r, 0, R[6] * r, R[7] * r, R[8] * r, 0, m.p[0], m.p[1], m.p[2], 1]);
  return [M, new Float32Array(R)];
}
/** which meshes are near enough to draw (sections around the followed marble, or all in build) */
function visible(): Array<{ mesh: Mesh; model?: Float32Array }> {
  const out: Array<{ mesh: Mesh; model?: Float32Array }> = [];
  const m = followed();
  const far = view === 'build' ? Infinity : 600;
  sections.forEach((s, i) => {
    if (view !== 'build' && Math.abs(i - m.sec) > 6) {
      // (a long way along the run: only if it's near in space)
      const e = s.end.p;
      if (len(sub(e, m.p)) > far) return;
    }
    out.push({ mesh: sectionMeshes[i] });
  });
  if (finishMesh && view !== 'build') out.push({ mesh: finishMesh });
  if (towerMesh_) out.push({ mesh: towerMesh_ });
  return out;
}
function drawMeshes(list: Array<{ mesh: Mesh; model?: Float32Array; normal?: Float32Array; tint?: V3; ghost?: boolean }>, shadowPass: boolean) {
  for (const { mesh, model, normal, tint, ghost } of list) {
    if (!mesh.count) continue;
    if (shadowPass) {
      gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, model ?? I4);
      gl.bindVertexArray(mesh.svao);
    } else {
      gl.uniformMatrix4fv(u(prog, 'uModel'), false, model ?? I4);
      gl.uniformMatrix3fv(u(prog, 'uNormal'), false, normal ?? I3);
      gl.uniform3fv(u(prog, 'uTint'), tint ?? [1, 1, 1]);
      gl.uniform1f(u(prog, 'uGhost'), ghost ? 1 : 0);
      gl.bindVertexArray(mesh.vao);
    }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}

let last = performance.now();
let time = 0;
let lag = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  resize();
  // the race, in fixed steps
  if (racing) {
    lag = Math.min(lag + dt, 0.1);
    impacts = [];
    while (lag >= 1 / 60) {
      lag -= 1 / 60;
      if (held()) { for (const m of marbles) { m.v = [0, 0, 0]; } raceTime += 1 / 60; continue; }
      step(course, marbles, 1 / 60, raceTime, impacts);
      raceTime += 1 / 60;
    }
    const me = followed();
    for (const im of impacts.slice(0, 4)) {
      // (the nearer the louder)
      const d = len(sub(im.at, me.p));
      knock(im.mat, im.j * Math.max(0.15, 1 - d / 120), im.other);
    }
    rollAt(len(me.v), me.contact);
    if (marbles.every((m) => m.finished >= 0) && racing) { racing = false; rollAt(0, false); }
  }
  updateCamera(dt);
  showBoard();

  const W = canvas.width, H = canvas.height;
  const fwd = norm(sub(look, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const upv = cross(right, fwd);
  const aspect = W / H;
  const fov = 0.9;
  const far = 2600;
  const vp = viewProj(eye, fwd, right, upv, fov, aspect, 1, far);
  // the sun's view: a box around the followed marble (or the end, building)
  const centre: V3 = view === 'build' ? (sections.length ? sections[sections.length - 1].end.p : TOP.p) : followed().p;
  const span = view === 'build' ? 110 : 70;
  const lightVP = ortho(centre, SUN, span, 400);
  const vis = visible();
  const live: Array<{ mesh: Mesh; model?: Float32Array; normal?: Float32Array; tint?: V3; ghost?: boolean }> = [...vis];
  // the spinners' arms where they are now, and the gate lifting
  {
    const bv: number[] = [];
    for (const s of sections) for (const b of s.boards) spinnerMesh(b, raceTime, bv);
    upload(bv, true, barMesh_);
    if (bv.length) live.push({ mesh: barMesh_ });
    const gv: number[] = [];
    if (sections.length) gateMesh(sections[0].boards[0], racing ? Math.min(9, raceTime * 24) : fromSection > 0 ? 9 : 0, gv);
    upload(gv, true, gateMesh_);
    if (gv.length) live.push({ mesh: gateMesh_ });
  }
  // (building, the marbles are out of the way: the end of the run is where the next board goes)
  const balls = view === 'build' ? [] : marbles.map((m) => { const [M, N] = marbleModel(m); return { mesh: SPHERE, model: M, normal: N, tint: m.tint, mat: m.mat }; });

  // 1. the shadow map
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.viewport(0, 0, SHADOW, SHADOW);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.useProgram(shadowProg);
  gl.uniformMatrix4fv(u(shadowProg, 'uLightVP'), false, lightVP);
  drawMeshes(live, true);
  gl.cullFace(gl.BACK);
  for (const b of balls) { gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, b.model); gl.bindVertexArray(SPHERE.svao); gl.drawArrays(gl.TRIANGLES, 0, SPHERE.count); }
  gl.disable(gl.CULL_FACE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2. the sky
  gl.viewport(0, 0, W, H);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  gl.uniform3fv(u(skyProg, 'uTop'), SKY_TOP);
  gl.uniform3fv(u(skyProg, 'uLow'), SKY_LOW);
  gl.uniformMatrix4fv(u(skyProg, 'uInvVP'), false, invert(vp));
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. the world
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, vp);
  gl.uniformMatrix4fv(u(prog, 'uLightVP'), false, lightVP);
  gl.uniform3fv(u(prog, 'uSun'), SUN);
  gl.uniform3fv(u(prog, 'uEye'), eye);
  gl.uniform1f(u(prog, 'uCut'), view === 'build' ? 4 : 8);
  gl.uniform3fv(u(prog, 'uFog'), FOG);
  gl.uniform3fv(u(prog, 'uSkyTop'), SKY_TOP);
  gl.uniform3fv(u(prog, 'uSkyLow'), SKY_LOW);
  gl.uniform1f(u(prog, 'uTime'), time);
  gl.uniform1f(u(prog, 'uFar'), far);
  gl.uniform1i(u(prog, 'uShadowMap'), 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.enable(gl.CULL_FACE);
  if (groundMesh_) drawMeshes([{ mesh: groundMesh_ }], false);
  gl.disable(gl.CULL_FACE);
  drawMeshes(live, false);
  // the marbles: opaque ones, then the glass over them
  gl.enable(gl.CULL_FACE);
  const solid = balls.filter((b) => b.mat.look !== 'glass'), glass = balls.filter((b) => b.mat.look === 'glass');
  for (const b of solid) { drawMeshes([{ mesh: SPHERE, model: b.model, normal: b.normal, tint: b.tint }], false); }
  // (a marble's material is its vertex material, so: one draw per look, the sphere's id rewritten)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  for (const b of glass) drawMeshes([{ mesh: SPHERE, model: b.model, normal: b.normal, tint: b.tint }], false);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  // building: the one on offer, see-through, at the end
  if (view === 'build' && ghostMeshes[chosen]) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawMeshes([{ mesh: ghostMeshes[chosen], ghost: true }], false);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
  (window as unknown as { __marbles: unknown }).__marbles = {
    seed, choices, sections: sections.length, racing, raceTime, view, chosen, offered: offered.map((s) => s.name),
    order: order(marbles).map((m) => ({ name: m.name, progress: Math.round(m.progress), finished: m.finished, falls: m.falls, speed: Math.round(len(m.v)) })),
    me: followed().name, eye: eye.map((v) => Math.round(v)),
  };
  requestAnimationFrame(frame);
}

/** The board: the order, the gaps, the time. */
let boardAt = 0;
function showBoard() {
  if (performance.now() - boardAt < 120) return;
  boardAt = performance.now();
  const o = order(marbles);
  const lead = o[0];
  $('board').innerHTML = o.map((m, i) => {
    const gap = m.finished >= 0 ? `${m.finished.toFixed(1)} s` : m === lead ? `${(m.progress / 100).toFixed(1)} m` : `−${((lead.progress - m.progress) / 100).toFixed(1)} m`;
    return `<div class="row${m.name === followed().name ? ' me' : ''}"><i style="background:${css(m.tint)}"></i><b>${i + 1}</b><span>${m.name}</span><em>${gap}</em></div>`;
  }).join('');
  $('clock').textContent = racing ? `${raceTime.toFixed(1)} s · ${Math.round(len(followed().v) / 100 * 3.6 * 10) / 10} km/h` : marbles.some((m) => m.finished >= 0) ? 'all in' : '';
}
const css = (c: V3) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

// ─── small maths ────────────────────────────────────────────────────────────────────────────────
function viewProj(e: V3, f: V3, r: V3, up: V3, fov: number, aspect: number, near: number, far: number): Float32Array {
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dotv(r, e), -dotv(up, e), -dotv(z, e), 1];
  const t = 1 / Math.tan(fov / 2);
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return mat4mul(proj, view);
}
/** the sun's orthographic view about a point */
function ortho(centre: V3, sun: V3, span: number, depth: number): Float32Array {
  const e = add(centre, mul(sun, depth / 2));
  const f = mul(sun, -1);
  const r = norm(cross(f, Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
  const up = cross(r, f);
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dotv(r, e), -dotv(up, e), -dotv(z, e), 1];
  const proj = [1 / span, 0, 0, 0, 0, 1 / span, 0, 0, 0, 0, -2 / depth, 0, 0, 0, -1, 1];
  return mat4mul(proj, view);
}
const dotv = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function mat4mul(a: number[] | Float32Array, b: number[] | Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
  return out;
}
function invert(m: Float32Array): Float32Array {
  const a = Array.from(m);
  const inv = new Array(16).fill(0);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12] || 1;
  return new Float32Array(inv.map((v) => v / det));
}

// ─── begin ──────────────────────────────────────────────────────────────────────────────────────
{
  const q = decode(params);
  let saved: { seed?: number; choices?: number[]; mine?: string; follow?: 'mine' | 'leader' } | null = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { /* */ }
  if (q.seed) { seed = q.seed; choices = q.choices; }
  else if (saved?.seed && !auto) { seed = saved.seed; choices = saved.choices ?? []; }
  else {
    // a fresh run: a seed and a first few sections chosen for it
    seed = auto ? 21 : Math.floor(Math.random() * 90000) + 1;
    const r = seeded(seed);
    choices = [];
    for (let i = 0; i < (auto ? 6 : 4); i++) choices.push(Math.floor(r() * 3));
  }
  mine = params.get('marble') ?? saved?.mine ?? 'glass';
  if (!FIELD.some((f) => f.name === mine)) mine = 'blue';
  follow = auto ? 'leader' : saved?.follow ?? 'mine';
  rebuildCourse();
  showFollow();
  resize();
  release(0);
  requestAnimationFrame(frame);
}
