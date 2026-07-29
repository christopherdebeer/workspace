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
// instance (bloom/controls break across mismatched three copies). esm.sh
// externalizes each addon's `three` to this same URL. Computed specifiers keep
// the whole three tree out of the SSR bundle (bundling it OOMs the deployer).
export const THREE_VER = '0.160.0';
export const esmURL = (path: string): string => `https://esm.sh/${path}`;

/**
 * A runtime CDN import that survives a flap. esm.sh serves these six modules
 * on demand and was measured (2026-07-29) FLAPPING — the same URL returning
 * 200, then 503, then 200 inside a minute. One 503 on any of the six used to
 * blank the whole graph ("3D renderer unavailable"), and worse, the old
 * `threeMod ??= import(...).catch(() => null)` CACHED the failure: every later
 * mount reused the null promise, so the sky stayed empty for the life of the
 * page while the CDN had long recovered. Verified in the devtools harness:
 * identical client + data renders the moment the imports succeed.
 *
 * Three bounded attempts with jittered backoff ride out a flap; a real outage
 * still fails (and the callers' "renderer unavailable" path still shows), but
 * the failure is no longer remembered — see the memo resets below.
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

let threeMod: Promise<any> | null = null;
export const loadThree = (): Promise<any> =>
  (threeMod ??= retryImport(esmURL(`three@${THREE_VER}`)).catch(() => {
    threeMod = null; // never cache a CDN failure — the next mount retries fresh
    return null;
  }));
let addonsMod: Promise<any> | null = null;
export const loadThreeAddons = (): Promise<any> =>
  (addonsMod ??= Promise.all([
    // The star-map camera is a hand-rolled quaternion rig now (see graph.tsx):
    // camera-controls orbits a target in spherical coords and gimbals at the
    // poles — no good for standing at the centre and looking OUT — so it was
    // dropped rather than fought.
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
    .catch(() => {
      addonsMod = null; // same rule: a flap must not blank the graph forever
      return null;
    }));

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
export function makeStarTexture(THREE: any, spike: number): any {
  const s = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const c = s / 2;
  // Core: hotter and tighter than the old disc — a star, not a blob.
  const core = g.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.42, `rgba(255,255,255,${0.35 - 0.15 * spike})`);
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
