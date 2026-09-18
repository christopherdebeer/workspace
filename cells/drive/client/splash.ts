import * as THREE from 'three';

/**
 * ── A SPLASH IS DRAWN, NOT SIMULATED ──
 *
 * The particle pool that used to do this was one shader shared by dust, grit
 * and water, so water inherited dust's assumptions: a round sprite with a
 * radial falloff, stretched along velocity, up to seven pixels of soft alpha,
 * flat unlit cyan, pushed deliberately over the bloom cut. Forty of those
 * around a wading truck read as pale confetti — reported from the seat as
 * comical, and correctly.
 *
 * WHY A SHEET AND NOT MORE DROPLETS. Real water thrown by a hull is a
 * CONNECTED MASS with a torn edge; it only becomes separate droplets at the
 * tips and at the end. Pixel art draws exactly that, and draws it as a
 * silhouette: a hard outline, two or three flat tones inside, no gradient at
 * all. Forty independent balls can never make that shape however they are
 * tuned, because the shape is not made of balls.
 *
 * THREE RULES, WITH THE DISPLAY LOOK LEFT TO THE POST PIPELINE.
 *
 * A CLEAN SILHOUETTE. The sprite clips only outside the connected thrown-water
 * shape. Its interior shading remains continuous; palette quantisation and
 * display dithering are owned exclusively by the global composite.
 *
 * WATER DEPTH IN THE SHAPE. The torn rim is brighter and the root darker, but
 * the transition is continuous so this material does not build a second,
 * effect-local palette.
 *
 * AND IT CHANGES SHAPE THROUGH LIFE: a tight column, a rising crown, a wide
 * sheet, a torn edge, fingers. The motion stays continuous here; the global
 * low-resolution composite supplies the game's cadence.
 *
 * The caller supplies the colour (the body's own water, lit by the day) and
 * the throw direction. Nothing in here knows what a truck is.
 */

/**
 * The tallest the shader ever draws a sheet, as a multiple of its `size` —
 * the peak of the growth curve in the vertex shader below. The caller needs
 * it to keep a splash under the roof of whatever made it.
 */
export const SPLASH_TALL_MAX = 1.45;
/** Sheets live and die fast; a pool this size never ran dry at speed. */
const N = 28;
export interface SplashEmit {
  /** Waterline position, world metres — the sprite stands ON this. */
  x: number;
  y: number;
  z: number;
  /** Horizontal throw direction; the sheet leans away along it. */
  dx: number;
  dz: number;
  /** Metres of sheet: how big the thing is. */
  size: number;
  /** 0 a symmetric entry crown, 1 a leaning bow sheet. */
  lean: number;
  /** Body colour, already lit by the caller. */
  tint: THREE.Color;
  /** Seconds the sheet lives. Short: a splash is over before it is thought about. */
  life: number;
}

export interface SplashSystem {
  readonly object3d: THREE.Object3D;
  emit(e: SplashEmit): void;
  step(dt: number, camera: THREE.Camera): void;
  /** Live sheets — the harness asserts on this. */
  alive(): number;
  /** Where the live sheets stand and how big they are, so a caller can prove
   *  none of them is over the thing that threw it. */
  peek(): Array<{ y: number; size: number; top: number }>;
  dispose(): void;
}

export function createSplash(): SplashSystem {
  const geo = new THREE.InstancedBufferGeometry();
  // A unit quad with its PIVOT AT THE BOTTOM CENTRE: the sprite stands on the
  // waterline and grows upward, which is what makes it look attached to the
  // surface rather than floating over it.
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const iPos = new Float32Array(N * 3);
  const iDir = new Float32Array(N * 2);
  const iTint = new Float32Array(N * 3);
  const iLife = new Float32Array(N);      // 1 at birth, 0 at death
  const iSize = new Float32Array(N);
  const iSeed = new Float32Array(N);
  const iLean = new Float32Array(N);
  const decay = new Float32Array(N);      // per-sheet 1/life
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 2));
  geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
  geo.setAttribute('iLife', new THREE.InstancedBufferAttribute(iLife, 1));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 1));
  geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1));
  geo.setAttribute('iLean', new THREE.InstancedBufferAttribute(iLean, 1));
  geo.instanceCount = N;

  const material = new THREE.ShaderMaterial({
    name: 'splash-sheets',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: { uRight: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: /* glsl */`
      attribute vec3 iPos; attribute vec2 iDir; attribute vec3 iTint;
      attribute float iLife; attribute float iSize; attribute float iSeed; attribute float iLean;
      uniform vec3 uRight;
      varying vec2 vLocal; varying float vLife; varying float vSeed;
      varying float vLean; varying vec3 vTint;
      void main() {
        vLife = iLife; vSeed = iSeed; vTint = iTint; vLean = iLean;
        // Dead sheets collapse to a point behind the camera rather than
        // branching — one pool, one draw, no per-instance culling.
        if (iLife <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vLocal = vec2(0.0); return; }
        vLocal = position.xy;
        // ── CYLINDRICAL BILLBOARD ──
        // Turned to face the camera about the WORLD's up, never tipped: a
        // splash stands on the water, and a fully camera-facing quad lies down
        // with the camera when the drone looks straight at it.
        vec3 up = vec3(0.0, 1.0, 0.0);
        // The frame the silhouette grows in: wide with life, and taller early.
        float f = 1.0 - iLife;
        // Modest growth, and TALL leads WIDE: water goes up first and opens
        // out after, which is the difference between a splash and a bloom.
        float wide = iSize * (0.5 + 0.85 * smoothstep(0.0, 0.6, f));
        float tall = iSize * (0.75 + 0.7 * smoothstep(0.0, 0.35, f)) * (1.0 - 0.28 * smoothstep(0.55, 1.0, f));
        vec3 world = iPos + uRight * (position.x * wide) + up * (position.y * tall);
        // The lean: a bow sheet is thrown along the travel, so its top edge
        // rides out over the water rather than standing straight up.
        world.xz += iDir * (position.y * tall * 0.55 * iLean);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vLocal; varying float vLife; varying float vSeed;
      varying float vLean; varying vec3 vTint;
      void main() {
        if (vLife <= 0.0) discard;
        // Continuous life. Pixel cadence, palette and dithering are supplied
        // by the global post process, never reconstructed in this material.
        float f = clamp(1.0 - vLife, 0.0, 1.0);
        // Local coordinates: x across (-0.5..0.5), y up from the waterline.
        float u = vLocal.x * 2.0;               // -1..1
        float y = vLocal.y;                     // 0..1
        if (y < 0.0 || abs(u) > 1.0) discard;
        // ── THE SILHOUETTE ──
        // A dome, scalloped into lobes, eroded into fingers as the frame
        // advances. The whole animation is these three terms moving: a tight
        // column that opens into a crown, tears at the top, and breaks into
        // separate tips before it goes.
        float dome = 1.0 - u * u * 0.78;
        float lobes = 0.10 * cos(u * 8.0 + vSeed * 6.283);
        float top = (dome + lobes) * (0.45 + 0.55 * smoothstep(0.0, 0.5, f));
        // Erosion: fingers appear late, deep enough to cut the top edge into
        // separate tips. A splash ENDS as droplets — this is where they come
        // from, so no separate droplet pass has to invent them.
        float finger = 0.5 + 0.5 * cos(u * 15.0 + vSeed * 11.0);
        top *= 1.0 - smoothstep(0.4, 1.0, f) * (0.12 + 0.8 * finger);
        if (y > top) discard;
        // The base is open water, not a wall: the sheet thins where it meets
        // the surface everywhere except the middle, so it reads as thrown
        // rather than as a fence standing in the river.
        float root = 0.18 * smoothstep(0.25, 1.0, f) * (1.0 - abs(u));
        if (y < root * (0.35 + 0.65 * finger)) discard;
        // ── DEPTH INTO THE SHAPE ──
        // Bright at the torn edge (thin water catches the light), darker at
        // the root, with a continuous response for the global palette pass.
        float into = clamp((top - y) / max(top, 0.001), 0.0, 1.0);
        float rim = 1.0 - smoothstep(0.04, 0.24, into);
        float rootShade = smoothstep(0.42, 0.92, into);
        vec3 col = vTint * (0.94 + rim * 0.30) * (1.0 - rootShade * 0.28);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'splash';
  mesh.frustumCulled = false;      // the pool is world-scattered; culling it as one box hides live sheets
  mesh.renderOrder = 31;           // over the water surface, under the HUD

  let cursor = 0;
  const right = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  return {
    object3d: mesh,
    emit(e) {
      // Oldest-first round robin: a sheet already dying is the right one to
      // take, and at N=28 with a ~0.4s life the pool never has to choose.
      let i = cursor, worst = 2;
      for (let k = 0; k < N; k++) {
        const j = (cursor + k) % N;
        if (iLife[j] <= 0) { i = j; break; }
        if (iLife[j] < worst) { worst = iLife[j]; i = j; }
      }
      cursor = (i + 1) % N;
      iPos[i * 3] = e.x; iPos[i * 3 + 1] = e.y; iPos[i * 3 + 2] = e.z;
      const dl = Math.hypot(e.dx, e.dz) || 1;
      iDir[i * 2] = e.dx / dl; iDir[i * 2 + 1] = e.dz / dl;
      iTint[i * 3] = e.tint.r; iTint[i * 3 + 1] = e.tint.g; iTint[i * 3 + 2] = e.tint.b;
      iLife[i] = 1;
      decay[i] = 1 / Math.max(0.08, e.life);
      iSize[i] = e.size;
      iSeed[i] = Math.random();
      iLean[i] = e.lean;
    },
    step(dt, camera) {
      let any = false;
      for (let i = 0; i < N; i++) {
        if (iLife[i] <= 0) continue;
        iLife[i] = Math.max(0, iLife[i] - dt * decay[i]);
        any = true;
      }
      // The billboard's right vector, once per frame for the whole pool.
      camera.getWorldDirection(camDir);
      right.crossVectors(camDir, UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
      (material.uniforms.uRight.value as THREE.Vector3).copy(right);
      if (!any) return;
      for (const a of ['iPos', 'iDir', 'iTint', 'iLife', 'iSize', 'iSeed', 'iLean']) {
        (geo.attributes[a] as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    },
    alive() {
      let n = 0;
      for (let i = 0; i < N; i++) if (iLife[i] > 0) n++;
      return n;
    },
    peek() {
      const out: Array<{ y: number; size: number; top: number }> = [];
      for (let i = 0; i < N; i++) {
        if (iLife[i] <= 0) continue;
        out.push({ y: iPos[i * 3 + 1], size: iSize[i], top: iPos[i * 3 + 1] + iSize[i] * SPLASH_TALL_MAX });
      }
      return out;
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
