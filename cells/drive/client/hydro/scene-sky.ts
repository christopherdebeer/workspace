import { CLOUD_GLSL } from '../cloud-field';

/**
 * The exact host-side environment contract compiled into production hydro and
 * Hydrograph. Uniform names are hydro-prefixed because the surface already
 * owns a wind vector and scene colours of its own.
 */
export const HYDRO_SCENE_SKY_GLSL = /* glsl */`${CLOUD_GLSL}
uniform sampler2D uCsTex; uniform vec2 uCsMin; uniform float uCsInv; uniform float uCsOn;
uniform vec2 uCsDrift; uniform vec2 uCsSkew; uniform float uCsDeckY; uniform float uCsScale;
uniform float uCsMpp; uniform vec3 uCsSunDisc; uniform float uCsLow; uniform float uCsNight;
uniform vec3 uCsDusk;
float sceneShade(vec3 p) {
  if (uCsOn < 0.005) return 1.0;
  vec2 hit = p.xz + uCsSkew * max(uCsDeckY - p.y, 0.0);
  vec2 wuv = (hit - uCsMin) * uCsInv;
  float covL = mix(uCsOn, texture2D(uCsTex, wuv).r, clInLattice(wuv));
  float wide = 1.0 - smoothstep(15.0, 60.0, uCsMpp);
  float cs = clCov(clfbm(hit * uCsScale + uCsDrift), covL);
  return 1.0 - min(covL * 1.4, 1.0) * cs * 0.5 * wide;
}
vec3 sceneReflectedSky(
  vec3 p, vec3 reflectedDirection, vec3 zenith, vec3 horizon,
  vec3 sunDirection, float roughness
) {
  vec3 d = normalize(reflectedDirection);
  float skyY = clamp(d.y, 0.0, 1.0);
  vec2 dh = normalize(d.xz + vec2(0.0001));
  vec2 sh = normalize(sunDirection.xz + vec2(0.0001));
  float towardS = dot(dh, sh);
  float toward = max(towardS, 0.0);
  float anti = max(-towardS, 0.0);
  // THE DOME'S OWN TWILIGHT, NOT A SECOND ONE. This mirror had its own warm
  // lobe (a partial mix toward a sun-tinted horizon, a quarter strength at
  // noon and seven tenths at dusk) and none of the rest of the dome's low-sun
  // sky: no belt along the whole horizon, no pink band over the anti-solar
  // horizon, no earth's shadow. From the seat at the Twelve Apostles at 18:00
  // that read as a saturated navy sea under a pink sky — the water was
  // mirroring a cooler, bluer sky than the one drawn above it. These are the
  // sky shader's own terms (main.ts, skyMat), on its own uniforms, so the
  // mirror and the dome cannot drift apart again.
  vec3 warm = mix(uCsSunDisc * 0.86, uCsDusk, uCsLow * 0.85);
  float az = pow(toward, mix(6.0, 1.5, uCsLow));
  vec3 hor = mix(horizon, warm, az * mix(0.30, 1.0, uCsLow));
  vec3 sky = mix(hor, zenith, pow(skyY, 0.42));
  float belt = exp(-skyY * mix(30.0, 6.0, uCsLow)) * uCsLow;
  sky = mix(sky, warm, clamp(belt * (0.22 + 0.55 * toward), 0.0, 0.85));
  float venus = exp(-abs(skyY - 0.05) * 24.0) * uCsLow * anti;
  sky = mix(sky, mix(uCsDusk, vec3(0.62, 0.44, 0.52), 0.55),
    clamp(venus * 0.45, 0.0, 0.6));
  float earthShade = exp(-skyY * 70.0) * uCsLow * anti;
  sky = mix(sky, zenith * 0.55, clamp(earthShade * 0.6, 0.0, 0.7));
  float sunLobe = pow(max(dot(d, sunDirection), 0.0),
    mix(180.0, 14.0, roughness));
  sky += uCsSunDisc * sunLobe * mix(0.18, 0.07, roughness);
  if (d.y > 0.015 && uCsOn > 0.005) {
    float deckH = uCsDeckY - p.y;
    if (deckH > 0.0) {
      vec2 hit = p.xz + d.xz * (deckH / max(d.y, 0.035));
      vec2 wuv = (hit - uCsMin) * uCsInv;
      float covL = mix(uCsOn, texture2D(uCsTex, wuv).r, clInLattice(wuv));
      vec2 cloudP = hit * uCsScale + uCsDrift;
      float cloudNoise = clfbm(cloudP);
      float resolved = 1.0 - clamp(roughness, 0.0, 1.0) * 0.72;
      float cloud = mix(covL * 0.34, clCov(cloudNoise, covL), resolved);
      float relief = clamp(
        (cloudNoise - clvn(cloudP + sh * 0.42)) * 3.0 + 0.5,
        0.0, 1.0
      );
      float thick = clamp(cloud * (0.72 + covL * 1.35), 0.0, 2.0);
      float opacity = 1.0 - exp(-thick * 3.5);
      vec3 cloudBase = mix(zenith * 1.28, horizon * 0.44, covL * 0.65);
      vec3 cloudTop = mix(vec3(0.82, 0.86, 0.91), warm,
        0.20 + toward * uCsLow * 0.48);
      vec3 cloudColour = mix(
        cloudBase,
        cloudTop,
        relief * (1.0 - thick * 0.26)
      );
      vec3 nightCloud = zenith * 0.66 + vec3(0.035, 0.045, 0.065);
      cloudColour = mix(cloudColour, nightCloud * (0.72 + relief * 0.48), uCsNight);
      sky = mix(sky, cloudColour, opacity * smoothstep(0.015, 0.10, d.y));
    }
  }
  return sky;
}`;
