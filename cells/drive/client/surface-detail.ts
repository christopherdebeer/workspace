/**
 * ── ONE RULER FOR EVERY PROCEDURAL SURFACE IN THE WORLD ──
 *
 * A surface detail is honest only while an art pixel is smaller than the thing
 * it draws. Past that it is not detail, it is a moiré beating against the
 * palette dither — and this renderer makes that worse than most, because 14
 * levels and a Bayer dither turn a half-resolved square wave into crawling
 * speckle rather than into grey.
 *
 * The terrain learned this first (see main.ts, TD_LAMBDA and the octave
 * cascade). The functions moved here because terrain was never the worst case.
 * `roof-fx.ts` draws corrugation ribs as
 *
 *     0.86 + 0.26 * step(0.5, fract(a / 0.15))
 *
 * — a FIFTEEN CENTIMETRE square wave at an amplitude of 0.26, which is about
 * three and a half palette levels. At two hundred metres an art pixel spans
 * roughly 0.65 m of a roof, so four ribs fall inside one pixel, and `step`
 * gives them infinite bandwidth to alias with. The terrain mottle it was sat
 * next to is a 15 m feature at 0.045: a hundredfold coarser and a fifth as
 * loud.
 *
 * That was survivable while the aerial perspective's `deep` term mixed the far
 * field toward `softTex`, because it blurred those frequencies away toward the
 * horizon. That term is off by default now (see AIR_BLUR — atmosphere is
 * contrast, not focus), so the thing that was masking roof and façade aliasing
 * has gone and nothing replaced it. Hence this module.
 *
 * ── HOW TO USE IT ──
 *
 * `sdPx(p)` takes ANY world-metric coordinate the shader already has — the
 * ground's xz, a roof's (across, down-slope) frame, a façade's (width, height)
 * — and returns how many metres of it one art pixel covers.
 *
 * `sdBand(px, lambda)` is 1 while that is comfortably finer than `lambda` and
 * 0 past Nyquist.
 *
 * And then the term is MIXED TOWARD ITS OWN MEAN, never toward zero:
 *
 *     tone = mix(meanOfTheTerm, theTerm, sdBand(px, period));
 *
 * which is what correct filtering converges to, and is why every call site
 * below carries the mean of its own step function as a number. Fading to zero
 * or to one would make distant roofs change colour, not lose texture.
 */

/** The geometric mean of the footprint, not the max — see the long note on
 *  `tdPx` in main.ts. The max is the along-ray number on a grazing surface and
 *  gating on it removes detail an order of magnitude too early; the geometric
 *  mean is the equal-area isotropic pixel a trilinear mip chain picks. */
export const SD_GLSL = `
float sdPx(vec2 p) {
  vec2 d = fwidth(p);
  return max(sqrt(max(d.x, 1e-5) * max(d.y, 1e-5)), 1e-4);
}
float sdBand(float px, float lambda) {
  return 1.0 - smoothstep(lambda * 0.25, lambda * 0.5, px);
}
`;

/** Full strength while a pixel spans under a quarter of the wavelength, gone by
 *  half of it — Nyquist. Exported so a probe can state the same numbers the
 *  shader uses rather than a second copy of them. */
export const sdKeep = (lambda: number): number => lambda * 0.25;
export const sdGone = (lambda: number): number => lambda * 0.5;
