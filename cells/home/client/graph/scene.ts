/* ---------------------------------------------------------------------------
 * graph/scene.ts — three.js loading, point-sprite textures, colour helpers.
 *
 * The raw-material for the 3D constellation: the pinned three + addon loaders
 * (one module instance so bloom/controls agree), the star/stipple/ring sprite
 * canvases, and the HSL/hex → rgb colour maths + the paper ink set. All pure /
 * closure-free — extracted from graph.tsx (decomposition, 2026-07-17) so the
 * render integration keeps only scene *wiring*, not scene *materials*.
 * ------------------------------------------------------------------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */

// three + its addons from a SINGLE pinned version so they share one module
// instance (bloom/controls break across mismatched three copies). Computed
// specifiers keep the whole three tree out of the SSR bundle (bundling it
// OOMs the deployer).
export const THREE_VER = '0.160.0';
export const esmURL = (path: string): string => `https://esm.sh/${path}`;

// ── the SELF-HOSTED 3D stack (primary), esm.sh (fallback) ──────────────────
// The whole tree — three r160 + the four addons + troika — bundled locally
// into ONE ESM file (cells/home/devtools/build-vendor.mjs) and uploaded as a
// public cell-data blob (scripts/upload-home-vendor.mjs): first-party, S3-
// backed, immutable-cached. esm.sh was measured (2026-07-29) FLAPPING — the
// same URL returning 200, then 503, then 200 inside a minute — and every
// mount gambled six third-party fetches on it. It remains only as the
// fallback for a stale/missing blob. The filename hash is the cache key: a
// new build mints a new name, and THIS constant must name it.
export const THREE_VENDOR_URL =
  'https://parc.land/@c15r/home/_data/c15r/public/vendor/three-vendor-3e4434cc.js';

/**
 * A runtime import that survives a flap: bounded attempts with jittered
 * backoff. A real outage still fails (and the callers' "renderer unavailable"
 * path still shows), but the failure is never remembered — the old
 * `threeMod ??= import(...).catch(() => null)` CACHED a null promise, so one
 * 503 blanked the sky for the life of the page while the CDN had long
 * recovered. See the memo reset in loadStack.
 */
const retryImport = async (url: string, attempts = 3): Promise<any> => {
  let lastErr: unknown;
  for (let n = 0; n < attempts; n++) {
    if (n > 0) await new Promise((r) => setTimeout(r, 350 * 2 ** n + Math.random() * 250));
    try {
      return await import(/* @vite-ignore */ url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
};

interface ThreeStack { THREE: any; addons: any }

/** ONE source decision per page-life: vendor bundle, else the esm.sh chain.
 *  Both loaders below resolve from the same decision, so a scene can never
 *  mix a vendor three with CDN addons (two module graphs — the exact
 *  mismatch the pinned version exists to prevent). A failed or partial stack
 *  resets the memo so the next mount retries fresh. */
let stackMod: Promise<ThreeStack | null> | null = null;
const loadStack = (): Promise<ThreeStack | null> =>
  (stackMod ??= (async (): Promise<ThreeStack | null> => {
    const vendor = await retryImport(THREE_VENDOR_URL, 2).catch(() => null);
    if (vendor?.THREE) {
      return {
        THREE: vendor.THREE,
        addons: {
          EffectComposer: vendor.EffectComposer,
          RenderPass: vendor.RenderPass,
          UnrealBloomPass: vendor.UnrealBloomPass,
          CSS2DRenderer: vendor.CSS2DRenderer,
          CSS2DObject: vendor.CSS2DObject,
          TroikaText: vendor.TroikaText,
          GUI: vendor.GUI,
        },
      };
    }
    // Fallback: esm.sh, every module from the SAME pinned version so the
    // addon's externalized `three` resolves to the one instance.
    const three = await retryImport(esmURL(`three@${THREE_VER}`)).catch(() => null);
    if (!three) return null;
    const addons = await Promise.all([
      // The star-map camera is a hand-rolled quaternion rig (see graph.tsx):
      // camera-controls orbits a target in spherical coords and gimbals at
      // the poles — no good for standing at the centre and looking OUT — so
      // it was dropped rather than fought.
      retryImport(esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/EffectComposer.js`)),
      retryImport(esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/RenderPass.js`)),
      retryImport(esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/UnrealBloomPass.js`)),
      retryImport(esmURL(`three@${THREE_VER}/examples/jsm/renderers/CSS2DRenderer.js`)),
      // SDF text (troika): node labels live IN the scene — they take the
      // camera's perspective (depth honesty for free), the tone mapping, and
      // the bloom, instead of floating on a DOM overlay. `deps` pins its
      // three to our version so the module graphs align.
      retryImport(esmURL(`troika-three-text@0.49.1?deps=three@${THREE_VER}`)),
    ])
      .then(([comp, rp, bloom, css, troika]) => ({
        EffectComposer: comp.EffectComposer,
        RenderPass: rp.RenderPass,
        UnrealBloomPass: bloom.UnrealBloomPass,
        CSS2DRenderer: css.CSS2DRenderer,
        CSS2DObject: css.CSS2DObject,
        TroikaText: troika.Text,
      }))
      .catch(() => null);
    return { THREE: three, addons };
  })().then((stack) => {
    // A missing stack — or one whose addons half failed — must not be
    // remembered: the sky can use a three-only stack THIS mount, but the
    // next mount retries the whole decision fresh.
    if (!stack || !stack.addons) stackMod = null;
    return stack;
  }));

export const loadThree = (): Promise<any> => loadStack().then((s) => s?.THREE ?? null);
export const loadThreeAddons = (): Promise<any> => loadStack().then((s) => s?.addons ?? null);

/** The ?tune=1 instrument panel's GUI class: from the vendor bundle when the
 *  stack came from it, else a one-off esm.sh fetch (the fallback stack does
 *  not carry it — the tuner is a flagged debug tool, not scene-critical). */
export const loadTuneGUI = (): Promise<any> =>
  loadStack().then((s) =>
    s?.addons?.GUI
      ?? retryImport(esmURL('lil-gui@0.19.2')).then((m: any) => m.default ?? m.GUI).catch(() => null));

// ── the SKY DOME shader (one source — graph.tsx and sky.tsx both mount it) ──
// A night sky is not a flat void, and not a bare gradient either. Three layers,
// each subtle, all dark by construction so additive stars glow over them:
//   1. the ATMOSPHERE — elevation gradient + amber airglow at the horizon
//      (the original dome), scaled by uAtmo;
//   2. DEEP SKY — domain-warped fbm nebulae in two hue families (indigo-teal
//      and rose-madder, the Hubble palette dimmed to dusk) plus a tilted
//      galactic band with a dust lane, scaled by uNebula;
//   3. the CLUSTER CLOUDS — an equirect texture splatted from the slice's own
//      node seats and type hues (built in graph.tsx at stream-settle), so the
//      substrate's real clusters read as their own faint nebulae. uCloudAmt
//      is 0 until the texture exists; sky.tsx leaves it 0 (no data there).
export const SKY_VERT =
  'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
/** Shared GLSL: value noise + fbm + quaternion rotate — the sky dome and the
 *  orrery terrain both build on these. */
export const NOISE_GLSL = `
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i),                 hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)),   hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)),   hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)),   hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.55; } return v; }
vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec2 equirect(vec3 d){ return vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.14159265); }
`;
export const SKY_FRAG = `
varying vec3 vDir;
uniform float uAtmo;
uniform float uNebula;
uniform vec3 uBase;
uniform sampler2D uCloud;
uniform vec4 uNebKey; // (wisp base, wisp data gain, band base, band data gain)
uniform vec3 uGrain;  // (amount, cell scale in device px, re-roll Hz — 0 freezes)
uniform float uTime;
${NOISE_GLSL}
void main(){
  float up = clamp(vDir.y, -1.0, 1.0);
  vec3 zenith = vec3(0.020, 0.023, 0.043);
  vec3 horizon = vec3(0.115, 0.086, 0.058);
  vec3 nadir = vec3(0.015, 0.013, 0.012);
  vec3 col = up >= 0.0 ? mix(horizon, zenith, smoothstep(0.0, 1.0, up)) : mix(horizon, nadir, smoothstep(0.0, 1.0, -up));
  col += vec3(0.16, 0.10, 0.045) * exp(-abs(up) * 5.5);
  col = mix(uBase, col, uAtmo);
  // deep sky: warp the field once, then read cloud density from the warped
  // coordinate — fbm(p + fbm(p)) is what turns smooth noise into wisps.
  vec3 w = vDir * 2.6;
  vec3 q = w + 1.6 * vec3(fbm(w + 5.2), fbm(w + 1.3), fbm(w + 9.7));
  float wisp = smoothstep(0.42, 0.78, fbm(q));
  float huemix = smoothstep(0.35, 0.65, fbm(vDir * 1.1 + 3.7));
  vec3 neb = mix(vec3(0.030, 0.075, 0.140), vec3(0.120, 0.045, 0.110), huemix) * wisp;
  // the galactic band: density falls off with distance from a tilted great
  // circle; a dark dust lane and fine grain keep it from reading as a stripe.
  float d = dot(vDir, normalize(vec3(0.38, 0.82, 0.42)));
  float band = exp(-d * d * 18.0);
  float lane = 1.0 - 0.75 * smoothstep(0.50, 0.72, fbm(vDir * 5.0 + 11.0));
  float grain = 0.65 + 0.35 * fbm(vDir * 8.0 + 23.0);
  vec3 milk = vec3(0.105, 0.085, 0.060) * band * lane * grain;
  // Position the deep sky off the DATA (owner: stylistically distinct,
  // positionally consistent): the same cluster map the terrain reads keys
  // the nebula amplitude — wisps bloom over the slice's real regions, the
  // band survives only where content is. vDir is LOCAL and the dome mesh
  // rides shellQ, so registration with the node seats is automatic. A small
  // baseline keeps the landing dome (no data) quietly decorated.
  float dataK = dot(texture2D(uCloud, equirect(vDir)).rgb, vec3(1.0));
  col += (neb * (uNebKey.x + uNebKey.y * dataK) + milk * (uNebKey.z + uNebKey.w * dataK)) * uNebula;
  // FILM GRAIN (owner 2026-07-31): noise that rides the dome's OWN light —
  // amplitude keys off how far the pixel has risen above the flat base, so
  // the atmosphere gradient and nebulae shimmer while the plain background
  // (and the orrery, where the dome layers are dialled to zero) stays clean.
  // The ANCHOR follows the speed dial (owner 2026-08-01): animated grain
  // (speed > 0) lives in the LENS — screen-space, re-rolled at uGrain.z Hz,
  // like stock — while frozen grain (speed 0) is print TOOTH, anchored to the
  // sky direction so panning carries it with the wisps instead of sliding
  // the sky under a dirty window. Sky cells are angular (~1/(700·scale) rad),
  // so the telescope magnifies them — physically consistent for paper.
  if (uGrain.x > 0.001) {
    // Frozen tooth uses SMOOTH value noise, not hash cells — under the
    // telescope's magnification hard cells read as checkerboard; noise
    // magnifies into soft mottle, like paper. (×1.6 restores the contrast
    // interpolation averages away.)
    float g = uGrain.z < 0.5
      ? 0.5 + (noise(vDir * (700.0 * uGrain.y)) - 0.5) * 1.6
      : hash(vec3(floor(gl_FragCoord.xy * uGrain.y), floor(uTime * uGrain.z)));
    float glow = dot(abs(col - uBase), vec3(1.0));
    col += (g - 0.5) * uGrain.x * glow;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ── the ORRERY TERRAIN: the cluster clouds as the held globe's surface ──────
// A unit sphere whose vertices are CANONICAL directions, morphed in the
// vertex shader by the exact curl transform the nodes use (graph.tsx
// curlPos) — so the surface bends with the stars through dome ↔ chart ↔ ball
// and, at full curl, IS the ball: radius uR0, centred (0,0,−2·uR0). The
// fragment paints the type-tinted cluster clouds as continents over a dark
// ground, textured with fbm so density reads as landform, not blobs. The
// mesh only shows in the orrery (opacity ∝ −curl, driven by graph.tsx).
export const TERRAIN_VERT = `
varying vec3 vCanon;
varying vec3 vNorm;
uniform vec4 uShellQ;
uniform float uCurl;
uniform float uR0;
vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main(){
  vCanon = normalize(position);
  vec3 w = qrot(uShellQ, vCanon);
  float ca = clamp(-w.z, -1.0, 1.0);
  float alpha = acos(ca);
  float sa = sqrt(max(0.0, 1.0 - ca * ca));
  vec2 u = sa > 1e-6 ? w.xy / sa : vec2(1.0, 0.0);
  float s = uCurl;
  float rho; float zeta;
  if (abs(s) < 1e-3) { rho = alpha; zeta = 1.0; }
  else { rho = sin(s * alpha) / s; zeta = 1.0 - (1.0 - cos(s * alpha)) / s; }
  vec3 pos = vec3(uR0 * rho * u.x, uR0 * rho * u.y, -uR0 * zeta);
  // The ball's outward normal (exact at full curl, where the surface is a
  // sphere of radius uR0 centred (0,0,-2·uR0)) — the terminator reads off it.
  vNorm = (pos - vec3(0.0, 0.0, -2.0 * uR0)) / uR0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;
// Terrain, not airbrush (owner IMG_0505 "doesn't feel like terrain yet"):
// the cluster density is THRESHOLDED into land against a dark sea, the
// coastline wanders with fbm (fractal edge, not a contour line), land gets
// slope shading from a directional fbm difference under a fixed sun, and the
// whole ball carries a terminator — the lit limb and night side that made
// IMG_0502 accidentally read right.
export const TERRAIN_FRAG = `
varying vec3 vCanon;
varying vec3 vNorm;
uniform sampler2D uCloud;
uniform float uAmt;
uniform float uCurl;
uniform vec3 uSun;
uniform vec4 uLand;  // (land cut, coast width, coast noise amp, land brightness)
uniform vec2 uShade; // (relief gain, night floor)
uniform float uGain; // overall brightness — alpha stays geometric (ghosting)
${NOISE_GLSL}
void main(){
  vec3 cloud = texture2D(uCloud, equirect(vCanon)).rgb;
  float d = max(cloud.r, max(cloud.g, cloud.b));
  // fractal coastline: the land threshold wanders with noise
  float coast = fbm(vCanon * 9.0 + 1.7);
  float land = smoothstep(uLand.x + uLand.z * coast, uLand.x + uLand.y + uLand.z * coast, d);
  float highland = smoothstep(0.16, 0.34, d);
  // relief: directional fbm difference = slope shading under the sun.
  // uSun is world-space: shell-fixed over the data centroid, biased toward
  // the viewer (graph.tsx) — the terminator moves with spin, the visible
  // face stays mostly lit.
  vec3 sun = uSun;
  float h1 = fbm(vCanon * 13.0 + 7.3);
  float h2 = fbm(vCanon * 13.0 + 7.3 + sun * 0.09);
  float slope = clamp(0.5 + (h1 - h2) * uShade.x, 0.0, 1.0);
  // the sea: dark ground with a faint wisp so an empty quarter stays a surface
  float wisp = smoothstep(0.35, 0.75, fbm(vCanon * 3.1 + 4.2));
  vec3 sea = vec3(0.013, 0.014, 0.022) + vec3(0.020, 0.030, 0.052) * wisp;
  // land keeps the cluster's type hue; brightness from density + relief
  vec3 hue = cloud / max(d, 1e-4);
  vec3 landCol = hue * (0.045 + 0.32 * d + 0.10 * highland) * (0.55 + 0.75 * slope) * uLand.w;
  // ONE substance, two dressings (owner: the curl transition must be
  // continuous): inside the dome the same surface reads as soft nebular
  // cloud overhead; held as a globe it reads as land/sea under a sun. The
  // blend rides the curl, so nothing teleports between vantages.
  float o = smoothstep(0.1, 0.8, clamp(-uCurl, 0.0, 1.0));
  vec3 soft = cloud * 1.5 + vec3(0.018, 0.026, 0.046) * wisp;
  float day = mix(1.0, uShade.y + (1.0 - uShade.y) * smoothstep(-0.25, 0.55, dot(normalize(vNorm), sun)), o);
  // SHALLOWS: any mapped presence tints the sea faintly, so an isolated
  // fact's star stands over glow, not void, even when its splat can't
  // cross the land threshold.
  float shallow = smoothstep(0.003, 0.018, d);
  vec3 seaLit = sea + hue * (0.018 + 0.020 * slope) * shallow;
  vec3 col = mix(soft, mix(seaLit, landCol, land), o) * day * uGain;
  gl_FragColor = vec4(col, uAmt);
}`;

/** A 1×1 black placeholder for uCloud so the sampler is always bound —
 *  sky.tsx uses it permanently, graph.tsx until the cluster clouds build. */
export function makeBlackTexture(THREE: any): any {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

/** HSL (h∈[0,360], s,l∈[0,1]) → [r,g,b] in [0,1], for colour buffers. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return s === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
/** PAPER'S INK SET (2026-07-12, owner: "paper palette still very shallow").
 *  The old formula — hsl(typeHue, 55%, 30%) — collapses every hue into the
 *  same dark mud at 30% lightness on cream: a wall of maroon with stray
 *  blue. Engraved atlases didn't mix continuous colour; they printed from a
 *  SMALL set of distinguishable inks. Type hue now quantizes to the nearest
 *  of seven period inks — related hues stay related across modes (the same
 *  type keeps its dusk hue FAMILY), but on paper each family is a genuinely
 *  separate, legible ink. */
const PAPER_INKS: Array<{ upTo: number; rgb: [number, number, number] }> = [
  { upTo: 25, rgb: hexToRgb01('#8f3b2c') },   // madder red
  { upTo: 70, rgb: hexToRgb01('#a0662a') },   // raw sienna / ochre
  { upTo: 160, rgb: hexToRgb01('#4a6135') },  // sap green
  { upTo: 205, rgb: hexToRgb01('#2f5d58') },  // slate teal
  { upTo: 262, rgb: hexToRgb01('#2e4a66') },  // prussian blue
  { upTo: 320, rgb: hexToRgb01('#5d4064') },  // plum violet
  { upTo: 360, rgb: hexToRgb01('#8f3b2c') },  // magenta wraps to madder
];
function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const paperInkFor = (hue: number): [number, number, number] =>
  (PAPER_INKS.find((i) => hue < i.upTo) ?? PAPER_INKS[0]).rgb;

/** '#rrggbb' → [r,g,b] in [0,1]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** The point sprite: a STAR — tight bright core, steep falloff, and four
 *  diffraction spikes whose strength rides `spike` (0 = the old soft disc).
 *  Bloom (threshold ~0 in the owner's grade) supplies the halo. */
export function makeStarTexture(THREE: any, spike: number, halo = 1): any {
  const s = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const c = s / 2;
  // Core: hotter and tighter than the old disc — a star, not a blob.
  // `halo` grades the baked soft falloff (the knobless glow source when bloom
  // is off): 1 = the original soft star, 0 = tight core + spikes only — the
  // mid-stop alpha scales down and the falloff truncates toward the core.
  const core = g.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.42, `rgba(255,255,255,${(0.35 - 0.15 * spike) * halo})`);
  core.addColorStop(Math.min(1, 0.5 + 0.5 * halo), 'rgba(255,255,255,0)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  if (spike > 0.01) {
    // Four diffraction spikes: thin gradients along the axes.
    const a = 0.85 * spike;
    for (const rot of [0, Math.PI / 2]) {
      g.save();
      g.translate(c, c);
      g.rotate(rot);
      const lg = g.createLinearGradient(-c, 0, c, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${a})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      const th = 1.6 + 1.4 * spike; // spike thickness
      g.fillRect(-c, -th / 2, s, th);
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
/** The PAPER point sprite: a crisp INK STAR — a filled four-pointed star
 *  (solid core, hard tapered rays, no gradient, no glow fringe), the way old
 *  celestial atlases actually stamp stars. First cut was a plain stipple
 *  disc; owner correction 2026-07-12: "dots should still be stars, just no
 *  gradient/bloom" — the star SHAPE carries the atlas idiom, only the soft
 *  falloff belonged to dusk. `spike` still grades ray length, same dial as
 *  the dusk sprite. Canvas AA gives the 1px edge softening; everything else
 *  is solid ink. */
export function makeStippleTexture(THREE: any, spike: number): any {
  const s = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const c = s / 2;
  const R = c * (0.5 + 0.48 * spike); // ray reach rides the spike dial
  const r = c * 0.3;                  // waist between rays (also the core disc)
  g.fillStyle = 'rgba(255,255,255,1)';
  // Four-pointed concave star: alternate outer ray tips and inner waist
  // points every 45°.
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4 - Math.PI / 2;
    const rad2 = i % 2 === 0 ? R : r;
    const x = c + Math.cos(ang) * rad2, y = c + Math.sin(ang) * rad2;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  // Round core so the body reads as a star with a heart, not a sharp jack.
  g.beginPath();
  g.arc(c, c, r * 1.05, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
/** A hollow ring sprite — the selection highlight around the chosen node. */
export function makeRingTexture(THREE: any): any {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  // A FINE ring — a drawn line, not a glowing donut (owner: finer, consistent
  // with the label hairline). Thin stroke, snug radius.
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
