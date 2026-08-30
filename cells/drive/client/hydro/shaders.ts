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

float waveSignal(vec2 p, vec2 direction, float time, float scale) {
  float speed = max(0.2, uWind.z);
  float wavelength = mix(2.4, 34.0, clamp(scale, 0.0, 1.0)) * max(0.05, uWaveLength);
  float k = 6.28318530718 / wavelength;
  vec2 crossDirection = vec2(-direction.y, direction.x);
  vec2 secondary = normalize(direction * 0.72 + crossDirection * 0.69);
  float a = sin(dot(p, direction) * k - time * (0.7 + speed * 0.16));
  float b = sin(dot(p, secondary) * k * 1.83
    - time * (1.05 + speed * 0.11) + 1.7);
  return a * 0.68 + b * 0.32;
}

void main() {
  vHydroUv = uv * uFieldUv.xy + uFieldUv.zw;
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  vec4 geometryL = texture2D(uHydroGeometry, vHydroUv - vec2(uHydroTexel.x, 0.0));
  vec4 geometryR = texture2D(uHydroGeometry, vHydroUv + vec2(uHydroTexel.x, 0.0));
  vec4 geometryD = texture2D(uHydroGeometry, vHydroUv - vec2(0.0, uHydroTexel.y));
  vec4 geometryU = texture2D(uHydroGeometry, vHydroUv + vec2(0.0, uHydroTexel.y));
  vec4 dynamicsL = texture2D(uHydroDynamics, vHydroUv - vec2(uHydroTexel.x, 0.0));
  vec4 dynamicsR = texture2D(uHydroDynamics, vHydroUv + vec2(uHydroTexel.x, 0.0));
  vec4 dynamicsD = texture2D(uHydroDynamics, vHydroUv - vec2(0.0, uHydroTexel.y));
  vec4 dynamicsU = texture2D(uHydroDynamics, vHydroUv + vec2(0.0, uHydroTexel.y));

  vec2 metres = max(uFieldMeters, vec2(0.01));
  vec2 shoreGradient = vec2(
    (geometryR.g - geometryL.g) / (2.0 * metres.x),
    (geometryU.g - geometryD.g) / (2.0 * metres.y)
  );
  vec2 levelGradient = vec2(
    (geometryR.b - geometryL.b) / (2.0 * metres.x),
    (geometryU.b - geometryD.b) / (2.0 * metres.y)
  );
  float flowTurn = 0.5 * (length(dynamicsR.xy - dynamicsL.xy)
    + length(dynamicsU.xy - dynamicsD.xy));

  float flowLength = length(dynamics.xy);
  vFlowing = smoothstep(0.2, 0.72, flowLength);
  float bankEnergy = 1.0 - smoothstep(0.35, 2.8, max(0.0, geometryField.g));
  float slopeEnergy = smoothstep(0.006, 0.075, length(levelGradient));
  float turnEnergy = smoothstep(0.055, 0.38, flowTurn);
  vTurbulence = vFlowing * clamp(slopeEnergy * 0.76 + turnEnergy * 0.42
    + bankEnergy * 0.12, 0.0, 1.0);

  vec2 wind = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 flowDirection = normalize(dynamics.xy + wind * (1.0 - vFlowing) + vec2(0.00001, 0.0));
  vec2 coastward = length(shoreGradient) > 0.0001 ? normalize(-shoreGradient) : wind;
  float depth = max(0.0, geometryField.a);
  float breakerDepth = mix(0.38, 3.8, clamp(dynamics.w, 0.0, 1.0))
    * (0.72 + min(uWind.z, 18.0) * 0.035) * mix(0.8, 1.2, clamp(uWaveAmplitude, 0.0, 2.0) * 0.5);
  float innerSurf = 1.0 - smoothstep(0.08, max(0.18, breakerDepth * 0.46), depth);
  float shallow = (1.0 - smoothstep(breakerDepth * 1.15, breakerDepth * 3.8, depth))
    * (1.0 - innerSurf);
  float refraction = (1.0 - vFlowing) * shallow * 0.78;
  vec2 waveDirection = normalize(mix(wind, coastward, refraction) + vec2(0.00001, 0.0));
  waveDirection = normalize(mix(waveDirection, flowDirection, vFlowing));

  float width = max(0.18, breakerDepth * 0.38);
  float depthDelta = (depth - breakerDepth) / width;
  vBreaker = (1.0 - vFlowing) * exp(-depthDelta * depthDelta) * geometryField.r;

  vec4 renderPosition = modelMatrix * vec4(position, 1.0);
  vAbsoluteXZ = renderPosition.xz + uWorldOrigin.xz;
  float wave = waveSignal(vAbsoluteXZ, waveDirection, uTime, dynamics.w);
  float sharpened = pow(max(0.0, wave), 4.0);
  float speed = max(0.2, uWind.z);
  float standingAmplitude = mix(0.015, 0.72, dynamics.w * dynamics.w)
    * (0.55 + min(speed, 16.0) * 0.045)
    * (1.0 + shallow * 0.58) * (1.0 - innerSurf * 0.88);
  float riverAmplitude = mix(0.008, 0.16, clamp(dynamics.w, 0.0, 1.0))
    * (0.32 + vTurbulence * 1.18);
  float amplitude = mix(standingAmplitude, riverAmplitude, vFlowing) * uWaveAmplitude;
  float displaced = (wave * 0.84 + sharpened * 0.16) * amplitude * geometryField.r;
  renderPosition.y = uElevationBase + geometryField.b - uWorldOrigin.y + displaced;

  vWaveCrest = smoothstep(0.48, 0.93, wave)
    * clamp(0.24 + vBreaker * 0.9 + vTurbulence * 0.85, 0.0, 1.0);
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

float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float x = q.x, y = q.y;
  float a = mod(x, 2.0) * 2.0 + mod(y, 2.0);
  float b = floor(x * 0.5) * 2.0 + floor(y * 0.5);
  return (a * 4.0 + b + 0.5) / 16.0;
}

vec3 palette(float kind, float depth, float turbidity) {
  vec3 shallow = vec3(0.20, 0.48, 0.48);
  vec3 deep = vec3(0.035, 0.15, 0.23);
  if (kind > 6.5 && kind < 10.5) {
    shallow = vec3(0.25, 0.43, 0.36);
    deep = vec3(0.07, 0.18, 0.18);
  } else if (kind > 3.5 && kind < 7.0) {
    shallow = vec3(0.27, 0.49, 0.42);
    deep = vec3(0.055, 0.20, 0.24);
  } else if (kind > 9.5) {
    shallow = vec3(0.31, 0.43, 0.29);
    deep = vec3(0.10, 0.19, 0.16);
  }
  shallow = mix(shallow, vec3(0.38, 0.34, 0.19), turbidity * 0.44);
  deep = mix(deep, vec3(0.16, 0.15, 0.095), turbidity * 0.32);
  float attenuation = 1.0 - exp(-max(depth, 0.0) * mix(0.42, 0.13, turbidity));
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
  return (small * 0.68 + capillary * 0.32) * mix(0.012, 0.17, scale) * uRippleStrength;
}

void main() {
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  // ── THE OUTLINE IS A CUT, NOT A STIPPLE ──
  //
  // This was coverage <= bayer4(gl_FragCoord.xy), an ordered dither that
  // turned partial coverage into scattered fragments. Two objections, both
  // from the seat. It is a SECOND dither: the composite already owns the
  // world's ink and has a dial for it, and this one kept stippling with that
  // dial off, so water alone could not be turned solid. And a river a few
  // metres wide is well under half a field texel, so almost every fragment of
  // it was a coin toss and the reach read as loose white pixels rather than
  // as water.
  //
  // Half coverage, hard, which is also the threshold sampleRestingSurface
  // classifies on — so the water you can see and the water the wheels find
  // are now the same set of texels rather than two answers that agree on
  // average. The shoreline is a texel edge at that point; softening it is the
  // shore-distance channel's job, which is continuous because it is a
  // distance, and not the coverage channel's.
  if (geometryField.r < 0.5) discard;
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  vec4 materialField = texture2D(uHydroMaterial, vHydroUv);
  float kind = floor(materialField.r * 255.0 + 0.5);
  float seed = materialField.g;
  float turbidity = materialField.b;

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
      float energy = max(vTurbulence, vBreaker);
      debugColour = mix(directionColour, vec3(1.0, 0.24, 0.07), energy * 0.88);
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

  vec2 wind = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 flow = dynamics.xy;
  float epsilon = mix(0.22, 0.75, dynamics.w);
  float hL = rippleHeight(vAbsoluteXZ - vec2(epsilon, 0.0), flow, wind, dynamics.w, seed);
  float hR = rippleHeight(vAbsoluteXZ + vec2(epsilon, 0.0), flow, wind, dynamics.w, seed);
  float hD = rippleHeight(vAbsoluteXZ - vec2(0.0, epsilon), flow, wind, dynamics.w, seed);
  float hU = rippleHeight(vAbsoluteXZ + vec2(0.0, epsilon), flow, wind, dynamics.w, seed);
  vec2 gradient = vec2(hR - hL, hU - hD) / (2.0 * epsilon);
  gradient *= 1.0 + vTurbulence * 1.9 + vBreaker * 0.55;
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));

  vec3 colour = palette(kind, geometryField.a, turbidity);
  float grain = valueNoise(vAbsoluteXZ * mix(0.28, 0.055, dynamics.w)
    + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
  colour *= 0.88 + grain * 0.20;
  colour = mix(colour, colour * 1.16, vTurbulence * (0.18 + grain * 0.18));

  vec3 lightDirection = normalize(uSunDirection);
  vec3 viewDirection = normalize(cameraPosition - vRenderPosition);
  float diffuse = 0.58 + max(0.0, dot(normal, lightDirection)) * 0.42;
  float glint = pow(max(0.0, dot(reflect(-lightDirection, normal), viewDirection)), 42.0);
  colour = colour * diffuse + vec3(1.0, 0.88, 0.56) * glint * (0.3 + dynamics.w * 0.55);

  float shoreWidth = mix(1.3, 4.8, dynamics.w) * max(0.05, uShoreFade);
  float shoreBand = 1.0 - smoothstep(0.18, shoreWidth, geometryField.g);
  float lappingFoam = (1.0 - vFlowing) * shoreBand * (0.07 + grain * 0.17);

  vec2 flowDirection = normalize(flow + vec2(0.00001, 0.0));
  vec2 crossFlow = vec2(-flowDirection.y, flowDirection.x);
  float downstream = dot(vAbsoluteXZ, flowDirection);
  float across = dot(vAbsoluteXZ, crossFlow);
  float foamStreak = valueNoise(vec2(downstream * 0.16 - uTime * (0.72 + vTurbulence * 1.15),
    across * 0.31 + seed * 13.0));
  float brokenWater = smoothstep(0.47, 0.76, foamStreak + grain * 0.22);
  float riverFoam = vFlowing * vTurbulence * brokenWater * (0.34 + vWaveCrest * 0.78);
  float breakerFoam = (1.0 - vFlowing) * vBreaker
    * smoothstep(0.38, 0.76, vWaveCrest + grain * 0.30);
  float whitecap = (1.0 - vFlowing) * smoothstep(8.5, 17.0, uWind.z)
    * dynamics.w * smoothstep(0.34, 0.82, vWaveCrest + grain * 0.18);
  float rainPocks = smoothstep(0.42, 0.9, valueNoise(vAbsoluteXZ * 0.72 - uTime * 1.8)) * uRain;
  float foam = clamp((lappingFoam + riverFoam * 0.82 + breakerFoam * 0.88
    + whitecap * 0.42 + rainPocks * 0.16) * uFoamStrength, 0.0, 0.92);
  colour = mix(colour, vec3(0.84, 0.91, 0.86), foam);

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
