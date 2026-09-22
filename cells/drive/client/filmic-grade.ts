/**
 * The compositor's two authored colour decisions. Values are deliberately
 * kept as data rather than buried in GLSL so the clock can interpolate them
 * and a test can hold the grade independently of a screenshot.
 *
 * Lift/gamma/gain use grading-wheel convention: 1 is neutral. `toe` is the
 * display-referred lift in the darkest quarter of the image; it is separate
 * because a multiplicative lift cannot pull exact black out of clipping.
 */
export const FILMIC_DAWN = Object.freeze({
  lift: [0.98, 0.99, 1.04] as const,
  gamma: [1.02, 0.98, 0.96] as const,
  gain: [1.08, 0.95, 0.92] as const,
  saturation: 1.15,
  toe: 0.05,
  exposure: 0.95,
});

export const FILMIC_MIDDAY = Object.freeze({
  lift: [0.96, 0.96, 0.98] as const,
  gamma: [0.97, 1.01, 0.99] as const,
  gain: [1.02, 1.02, 1.00] as const,
  saturation: 1.08,
  toe: 0.012,
  exposure: 1.00,
});

export const FILMIC_DEPTH = Object.freeze({
  tint: [0.85, 0.92, 1.05] as const,
  saturation: 0.85,
  amount: 0.34,
});

/** Dawn/dusk and the dark side of civil twilight take the dawn decision;
 * open daylight takes midday. The max matters at the horizon: `daylight` is
 * already two-thirds there, while `twilight` correctly says the low sun is at
 * its strongest. */
export function filmicDawnWeight(daylight: number, twilight: number): number {
  return Math.max(0, Math.min(1, Math.max(1 - daylight, twilight)));
}

/** CPU reference for the ACES fitted RRT/ODT used by the shader below. */
export function acesFitted(rgb: readonly [number, number, number], exposure = 1): [number, number, number] {
  const s = exposure / 0.6;
  const r = Math.max(0, rgb[0]) * s;
  const g = Math.max(0, rgb[1]) * s;
  const b = Math.max(0, rgb[2]) * s;
  const ap1: [number, number, number] = [
    0.59719 * r + 0.35458 * g + 0.04823 * b,
    0.07600 * r + 0.90834 * g + 0.01566 * b,
    0.02840 * r + 0.13383 * g + 0.83777 * b,
  ];
  const fit = ap1.map((v) => {
    const a = v * (v + 0.0245786) - 0.000090537;
    const d = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / d;
  }) as [number, number, number];
  const out: [number, number, number] = [
    1.60475 * fit[0] - 0.53108 * fit[1] - 0.07367 * fit[2],
    -0.10208 * fit[0] + 1.10813 * fit[1] - 0.00605 * fit[2],
    -0.00327 * fit[0] - 0.07276 * fit[1] + 1.07602 * fit[2],
  ];
  return out.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
}

/**
 * Shared by the world composite and the inset renderer. Input is scene-linear
 * Rec.709/sRGB primaries; `filmicAces` explicitly moves it through the ACES
 * AP1 fit and back before display encoding.
 */
export const FILMIC_GLSL = `
  vec3 filmicSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
      step(vec3(0.0031308), c));
  }
  vec3 filmicRrtOdt(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 filmicAces(vec3 color, float exposure) {
    const mat3 toAp1 = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 fromAp1 = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602)
    );
    color = toAp1 * (max(color, vec3(0.0)) * exposure / 0.6);
    return clamp(fromAp1 * filmicRrtOdt(color), 0.0, 1.0);
  }
  vec3 filmicRgbToHsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)),
      d / (q.x + 1e-10), q.x);
  }
  vec3 filmicHsvToRgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  float filmicBand(float x, float lo, float hi, float feather) {
    return smoothstep(lo - feather, lo, x) * (1.0 - smoothstep(hi, hi + feather, x));
  }
  vec3 filmicSecondaries(vec3 enc, float rigMask) {
    vec3 hsv = filmicRgbToHsv(clamp(enc, 0.0, 1.0));
    float yellow = filmicBand(hsv.x, 0.125, 0.205, 0.025) * smoothstep(0.16, 0.42, hsv.y);
    // Dry, bright ground leaves the old olive bracket for warm straw (42°).
    float straw = yellow * (1.0 - rigMask) * smoothstep(0.30, 0.58, hsv.z);
    // Darker living greens separate toward pine (110°), away from the straw.
    float pine = filmicBand(hsv.x, 0.17, 0.42, 0.035) * (1.0 - rigMask)
      * smoothstep(0.18, 0.45, hsv.y) * (1.0 - smoothstep(0.52, 0.74, hsv.z));
    hsv.x = mix(hsv.x, 42.0 / 360.0, straw * 0.58);
    hsv.x = mix(hsv.x, 110.0 / 360.0, pine * 0.52);
    // rtScene alpha is the already-authored rig mask, so this is a genuine
    // vehicle isolation rather than a yellow key that also catches the grass.
    float vehicleYellow = filmicBand(hsv.x, 0.09, 0.21, 0.035) * rigMask
      * smoothstep(0.18, 0.40, hsv.y);
    hsv.y = min(hsv.y * (1.0 + 0.12 * vehicleYellow), 1.0);
    hsv.z = min(hsv.z + smoothstep(0.55, 0.90, hsv.z) * 0.035 * vehicleYellow, 1.0);
    return filmicHsvToRgb(hsv);
  }
  vec3 filmicDepthGrade(vec3 linear, float depthF, vec3 tint, float saturation, float amount) {
    float l = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    vec3 slate = mix(vec3(l), linear, saturation) * tint;
    return mix(linear, slate, clamp(depthF * amount, 0.0, 0.5));
  }
  vec3 filmicGrade(vec3 linear, float rigMask, vec3 lift, vec3 gamma,
      vec3 gain, float saturation, float toe, float exposure) {
    vec3 c = max(linear, vec3(0.0));
    float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float shadows = 1.0 - smoothstep(0.06, 0.34, y);
    float mids = smoothstep(0.035, 0.18, y) * (1.0 - smoothstep(0.58, 1.15, y));
    float highs = smoothstep(0.52, 1.15, y);
    c *= mix(vec3(1.0), lift, shadows);
    c = mix(c, pow(max(c, vec3(1e-6)), vec3(1.0) / max(gamma, vec3(0.01))), mids);
    c *= mix(vec3(1.0), gain, highs);
    vec3 enc = filmicSrgb(filmicAces(c, exposure));
    float displayL = dot(enc, vec3(0.299, 0.587, 0.114));
    enc = mix(vec3(displayL), enc, saturation);
    float toeF = 1.0 - smoothstep(0.035, 0.28, displayL);
    enc += vec3(0.66, 0.82, 1.0) * toe * toeF;
    return clamp(filmicSecondaries(enc, rigMask), 0.0, 1.0);
  }`;
