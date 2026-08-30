/**
 * ── QUIET WATER, BUILT TO SURVIVE THE QUANTISER ──
 *
 * Everything this game draws passes through a quantise/dither post pipeline,
 * and that pipeline is merciless to two things: moderate periodic variation,
 * which it promotes into hard alternating stripes, and narrow bright
 * features, which it promotes into white contour diagrams. The first version
 * of this shader produced both, and the analysis that led to this rewrite
 * named the mechanisms exactly. They are worth keeping on record here,
 * because each one is a mistake the code could drift back into:
 *
 * THE PHASE MUST BE CONTINUOUS. The old wave evaluated
 * sin(dot(p, d(p)) - wt) with a direction d that varied per vertex (wind
 * bent toward the shore gradient, bent toward flow). A spatially varying
 * direction inserted into the phase is not a wave — where d(p) rotates, the
 * phase folds, and folded phase is the concentric fingerprint pattern the
 * sea showed every afternoon. The rewrite uses two individually continuous
 * signals and crossfades their AMPLITUDES: offshore, a swell with one
 * constant direction per frame; nearshore, crests that follow the shoreline
 * by using the signed shore-distance field itself as the phase coordinate.
 * Shore distance is continuous by construction (it is a distance), so its
 * isolines are the crest lines, which is exactly what refraction should do
 * to a first approximation. Direction is never inserted into a phase again.
 *
 * ENERGY IS DECIDED ON THE CPU. River turbulence used to be derived per
 * vertex from raw level gradients and flow turns, which saturated on DEM
 * noise until every reach read as rapids. The field's dynamics.w channel now
 * carries a station-based energy computed in build-tile from the river's own
 * longitudinal profile — smoothed, so rapids form coherent reaches. The
 * shader treats it as settled fact. For standing water the same channel is
 * the sea state, as before.
 *
 * FOAM IS SPARSE, CAUSAL AND BRIEF. Foam appears only above a high energy
 * threshold, fragmented by advected noise with a low duty cycle, aligned
 * downstream, and never as a bank-long outline. A calm reach shows no white
 * at all in a still frame.
 *
 * LIGHT COMES FROM THE SKY. The water darkens with the sun: a daylight
 * factor from the sun's elevation scales the whole response and cools it at
 * night, so midnight water is a dark mass rather than daytime cyan. The
 * glint is broad and low — a narrow specular crest is exactly the feature
 * the quantiser turns into white bands.
 *
 * DETAIL FADES WITH DISTANCE. Ripple amplitude, grain and glint attenuate
 * with camera distance so unresolved high-frequency structure never reaches
 * the quantiser, and far water is simpler and calmer than near water.
 *
 * VISUAL DEPTH IS NOT BATHYMETRY. Nearshore, real depth drives shoaling and
 * the breaker band. Offshore, colour depth becomes a smooth function of
 * shore distance, because raw DEM bathymetry painted patch-by-patch is the
 * camouflage the sea used to wear.
 */

export const HYDRO_VERTEX_SHADER = /* glsl */`
precision highp float;

uniform sampler2D uHydroGeometry;
uniform sampler2D uHydroDynamics;
uniform vec4 uFieldUv;
uniform vec2 uHydroTexel;
uniform vec2 uFieldMeters;
uniform float uElevationBase;
uniform float uTime;
uniform vec3 uWorldOrigin;
uniform vec3 uWind;
uniform float uWaveAmplitude;
uniform float uWaveLength;
uniform float uShoreFade;

varying vec2 vHydroUv;
varying vec2 vAbsoluteXZ;
varying vec3 vRenderPosition;
varying float vWaveCrest;
varying float vBreaker;
varying float vTurbulence;
varying float vFlowing;

#include <common>
#include <fog_pars_vertex>

void main() {
  vHydroUv = uv * uFieldUv.xy + uFieldUv.zw;
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);

  float flowLength = length(dynamics.xy);
  vFlowing = smoothstep(0.2, 0.72, flowLength);
  // dynamics.w: CPU station energy for flowing water, sea state for standing.
  float energy = clamp(dynamics.w, 0.0, 1.0);
  vTurbulence = vFlowing * smoothstep(0.4, 0.85, energy);

  float depth = max(0.0, geometryField.a);
  float shoreDist = geometryField.g;

  vec4 renderPosition = modelMatrix * vec4(position, 1.0);
  vAbsoluteXZ = renderPosition.xz + uWorldOrigin.xz;

  // ── THE PHASE, CONTINUOUS BY CONSTRUCTION ──
  // One constant-direction swell for open water; one shore-following wave
  // whose phase coordinate IS the signed shore distance. Each is continuous
  // everywhere; only their amplitudes crossfade.
  float speed = max(0.2, uWind.z);
  float wavelength = mix(9.0, 34.0, clamp(energy, 0.0, 1.0)) * max(0.05, uWaveLength);
  float k = 6.28318530718 / wavelength;
  float omega = 0.6 + speed * 0.1;
  vec2 windDir = normalize(uWind.xy + vec2(0.00001, 0.0));
  float swell = sin(dot(vAbsoluteXZ, windDir) * k - uTime * omega);
  // Crests shorten as they shoal; +time advances them toward the waterline
  // (decreasing shore distance).
  float shoreK = 6.28318530718 / max(5.0, wavelength * 0.55);
  float shoreWave = sin(shoreDist * shoreK + uTime * omega * 0.9);
  float nearShore = (1.0 - smoothstep(14.0, 70.0, max(0.0, shoreDist))) * (1.0 - vFlowing);
  float wave = mix(swell, shoreWave, nearShore);

  // ── THE BREAKER BAND, NARROW AND DEPTH-DEPENDENT ──
  float breakerDepth = mix(0.5, 2.4, energy);
  float depthDelta = (depth - breakerDepth) / max(0.25, breakerDepth * 0.45);
  vBreaker = (1.0 - vFlowing) * exp(-depthDelta * depthDelta) * geometryField.r;

  // Crest selection is for STANDING water only. A river's white comes from
  // its energy field, never from tracing displacement crests — traced crests
  // are the conveyor-belt bands.
  vWaveCrest = smoothstep(0.55, 0.95, wave) * (1.0 - vFlowing);

  // ── AMPLITUDE: CALM BASELINE, SIMPLER WITH DISTANCE ──
  float camDist = distance(cameraPosition, renderPosition.xyz);
  float distFade = 1.0 / (1.0 + camDist * 0.0035);
  float standingAmplitude = mix(0.012, 0.34, energy * energy)
    * (0.5 + min(speed, 16.0) * 0.03) * (1.0 + vBreaker * 0.5);
  float riverAmplitude = mix(0.004, 0.05, energy);
  float amplitude = mix(standingAmplitude, riverAmplitude, vFlowing)
    * uWaveAmplitude * distFade;
  float displaced = wave * amplitude * geometryField.r;
  renderPosition.y = uElevationBase + geometryField.b - uWorldOrigin.y + displaced;

  vRenderPosition = renderPosition.xyz;
  vec4 mvPosition = viewMatrix * renderPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const HYDRO_FRAGMENT_SHADER = /* glsl */`
precision highp float;

uniform sampler2D uHydroGeometry;
uniform sampler2D uHydroDynamics;
uniform sampler2D uHydroMaterial;
uniform float uTime;
uniform vec3 uWind;
uniform float uRain;
uniform vec3 uSunDirection;
uniform float uDebugView;
uniform float uRippleStrength;
uniform float uFoamStrength;
uniform float uShoreFade;

varying vec2 vHydroUv;
varying vec2 vAbsoluteXZ;
varying vec3 vRenderPosition;
varying float vWaveCrest;
varying float vBreaker;
varying float vTurbulence;
varying float vFlowing;

#include <common>
#include <fog_pars_fragment>

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
}

// Darker and closer to the surrounding landscape than the first cut, whose
// water was among the highest-contrast elements in the frame. Calm water
// should sit INTO the land, not on top of it.
vec3 palette(float kind, float depth, float turbidity) {
  vec3 shallow = vec3(0.14, 0.33, 0.36);
  vec3 deep = vec3(0.03, 0.115, 0.16);
  if (kind > 6.5 && kind < 10.5) {
    // river / stream / canal
    shallow = vec3(0.15, 0.25, 0.23);
    deep = vec3(0.055, 0.125, 0.125);
  } else if (kind > 3.5 && kind < 7.0) {
    // lake / pond / reservoir / basin
    shallow = vec3(0.16, 0.31, 0.28);
    deep = vec3(0.045, 0.14, 0.16);
  } else if (kind > 9.5) {
    // wetland
    shallow = vec3(0.20, 0.28, 0.20);
    deep = vec3(0.08, 0.14, 0.12);
  }
  shallow = mix(shallow, vec3(0.30, 0.27, 0.16), turbidity * 0.44);
  deep = mix(deep, vec3(0.13, 0.12, 0.08), turbidity * 0.32);
  float attenuation = 1.0 - exp(-max(depth, 0.0) * mix(0.5, 0.16, turbidity));
  return mix(shallow, deep, clamp(attenuation, 0.0, 1.0));
}

float rippleHeight(vec2 p, vec2 flow, vec2 wind, float scale, float seed) {
  float speed = max(0.2, uWind.z);
  vec2 direction = length(flow) > 0.15 ? normalize(flow) : wind;
  vec2 crossDirection = vec2(-direction.y, direction.x);
  float small = sin(dot(p, direction) * mix(2.8, 0.55, scale)
    - uTime * (1.7 + speed * 0.12) + seed * 6.283);
  float capillary = sin(dot(p, normalize(direction + crossDirection * 0.57)) * mix(5.8, 1.1, scale)
    - uTime * (2.5 + speed * 0.08) + 2.1);
  return (small * 0.68 + capillary * 0.32) * mix(0.012, 0.1, scale) * uRippleStrength;
}

void main() {
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  // ── THE OUTLINE IS A CUT, NOT A STIPPLE ──
  //
  // The composite owns the world's ink and has a dial for it; a second
  // in-shader dither kept stippling with that dial off, and a river a few
  // metres wide (well under half a field texel) became loose white pixels.
  // Half coverage is also the threshold sampleRestingSurface classifies on,
  // so the water you can see and the water the wheels find are the same set
  // of texels. Softening the shoreline is the shore-distance channel's job.
  if (geometryField.r < 0.5) discard;
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  vec4 materialField = texture2D(uHydroMaterial, vHydroUv);
  float kind = floor(materialField.r * 255.0 + 0.5);
  float seed = materialField.g;
  float turbidity = materialField.b;
  float energy = clamp(dynamics.w, 0.0, 1.0);

  if (uDebugView > 0.5) {
    vec3 debugColour = vec3(0.0);
    if (uDebugView < 1.5) {
      debugColour = vec3(geometryField.r);
    } else if (uDebugView < 2.5) {
      float signedShore = clamp(0.5 + geometryField.g / 30.0, 0.0, 1.0);
      debugColour = mix(vec3(0.72, 0.19, 0.15), vec3(0.15, 0.72, 0.61), signedShore);
    } else if (uDebugView < 3.5) {
      debugColour = mix(vec3(0.89, 0.72, 0.25), vec3(0.04, 0.12, 0.34), clamp(geometryField.a / 18.0, 0.0, 1.0));
    } else if (uDebugView < 4.5) {
      vec3 directionColour = vec3(dynamics.xy * 0.5 + 0.5, 0.28);
      debugColour = mix(directionColour, vec3(1.0, 0.24, 0.07), max(vTurbulence, vBreaker) * 0.88);
    } else {
      float hue = fract(kind * 0.173 + 0.07);
      debugColour = 0.55 + 0.45 * cos(6.28318 * (hue + vec3(0.0, 0.67, 0.33)));
    }
    gl_FragColor = vec4(debugColour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }

  // ── DETAIL BUDGET BY DISTANCE ──
  // Nothing below the final screen resolution may reach the quantiser: fine
  // normal detail, grain and glint all attenuate with camera distance, so
  // far water is calm and simple rather than aliased.
  float camDist = distance(cameraPosition, vRenderPosition);
  float detailFade = 1.0 / (1.0 + camDist * 0.006);

  vec2 wind = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 flow = dynamics.xy;
  float epsilon = mix(0.22, 0.75, energy);
  float hL = rippleHeight(vAbsoluteXZ - vec2(epsilon, 0.0), flow, wind, energy, seed);
  float hR = rippleHeight(vAbsoluteXZ + vec2(epsilon, 0.0), flow, wind, energy, seed);
  float hD = rippleHeight(vAbsoluteXZ - vec2(0.0, epsilon), flow, wind, energy, seed);
  float hU = rippleHeight(vAbsoluteXZ + vec2(0.0, epsilon), flow, wind, energy, seed);
  vec2 gradient = vec2(hR - hL, hU - hD) / (2.0 * epsilon);
  gradient *= (1.0 + vTurbulence * 0.8) * detailFade;
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));

  // ── VISUAL DEPTH, SEPARATED FROM RAW BATHYMETRY ──
  // Nearshore keeps the true depth so shoaling and the breaker band read;
  // offshore the colour depth becomes a smooth function of shore distance,
  // because DEM bathymetry mapped patch-by-patch into colour is camouflage.
  float shoreDist = max(0.0, geometryField.g);
  float offshore = smoothstep(15.0, 70.0, shoreDist) * (1.0 - vFlowing);
  float visualDepth = mix(min(geometryField.a, 14.0),
    min(4.0 + shoreDist * 0.1, 14.0), offshore);

  vec3 colour = palette(kind, visualDepth, turbidity);
  float grain = valueNoise(vAbsoluteXZ * mix(0.28, 0.055, energy)
    + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
  colour *= 1.0 + (grain - 0.5) * 0.14 * detailFade;

  // ── LIGHT FROM THE SKY, NOT ONLY THE SUN VECTOR ──
  // The daylight factor follows the sun's elevation: dusk rolls the water
  // down and cools it, and midnight water is a dark blue-green mass with no
  // daytime cyan left in it.
  vec3 lightDirection = normalize(uSunDirection);
  vec3 viewDirection = normalize(cameraPosition - vRenderPosition);
  float daylight = smoothstep(-0.04, 0.22, lightDirection.y);
  float diffuse = mix(0.10, 1.0, daylight)
    * (0.74 + max(0.0, dot(normal, lightDirection)) * 0.26);
  colour *= diffuse;
  colour = mix(colour * vec3(0.55, 0.75, 0.85), colour, daylight);
  // The glint is broad and quiet. A narrow bright crest highlight is what
  // the quantiser promotes into white wave diagrams at low sun.
  float glint = pow(max(0.0, dot(reflect(-lightDirection, normal), viewDirection)), 9.0);
  colour += vec3(1.0, 0.9, 0.7) * glint * 0.10 * daylight * detailFade;

  // ── FOAM: SPARSE, CAUSAL, BRIEF ──
  vec2 flowDirection = normalize(flow + vec2(0.00001, 0.0));
  vec2 crossFlow = vec2(-flowDirection.y, flowDirection.x);
  float downstream = dot(vAbsoluteXZ, flowDirection);
  float across = dot(vAbsoluteXZ, crossFlow);
  // River froth: only above a high energy threshold, fragmented into
  // downstream-aligned streaks with a low duty cycle. A calm reach shows
  // nothing; a rapid shows white over a minority of its surface.
  float energyGate = smoothstep(0.55, 0.82, energy);
  float foamStreak = valueNoise(vec2(downstream * 0.16 - uTime * (0.72 + energy * 1.1),
    across * 0.31 + seed * 13.0));
  float riverFoam = vFlowing * energyGate
    * smoothstep(0.66, 0.9, foamStreak + grain * 0.12) * 0.6;
  // Breakers: crests inside the narrow depth band, spatially fragmented so
  // the surf zone is broken white patches rather than a shoreline outline.
  float crestPick = smoothstep(0.6, 0.92, vWaveCrest);
  float fragmentNoise = smoothstep(0.42, 0.72,
    valueNoise(vec2(across * 0.14 + seed * 7.0, downstream * 0.05 - uTime * 0.3)));
  float breakerFoam = (1.0 - vFlowing) * vBreaker * crestPick * fragmentNoise;
  // Residual surf-zone foam: sparse flecks, not a band.
  float lappingFoam = (1.0 - vFlowing)
    * (1.0 - smoothstep(0.2, mix(1.3, 4.8, energy) * max(0.05, uShoreFade), shoreDist))
    * smoothstep(0.74, 0.9, valueNoise(vAbsoluteXZ * 0.5 + vec2(0.0, uTime * 0.22))) * 0.5;
  float whitecap = (1.0 - vFlowing) * smoothstep(9.5, 17.0, uWind.z)
    * energy * crestPick * fragmentNoise * 0.5;
  float rainPocks = smoothstep(0.42, 0.9, valueNoise(vAbsoluteXZ * 0.72 - uTime * 1.8)) * uRain;
  float foam = clamp((lappingFoam + riverFoam + breakerFoam * 0.8
    + whitecap + rainPocks * 0.14) * uFoamStrength, 0.0, 0.75) * detailFade;
  // Foam takes the scene's light too — white paint at midnight is a bug.
  vec3 foamColour = vec3(0.84, 0.9, 0.88) * mix(0.14, 1.0, daylight);
  colour = mix(colour, foamColour, foam);

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
