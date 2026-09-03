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
 * RIVERS LIVE IN RIVER SPACE. The river terms held the very defect the rule
 * above was written against: dot(worldPosition, flowDirection(texel)), a
 * direction that turns at every bend, inside every phase. The cure is the
 * same as the shore wave's — find the coordinate that is continuous by
 * construction and phase on THAT. For a river it is `s`, distance along the
 * channel, with `n` the signed cross-channel position: both computed on the
 * CPU per texel (build-tile), continuous across streamed fragments (the
 * registry's river spans), and delivered in the private structure field.
 * Every flowing phase is now wavenumber × s − ω × t with CONSTANT k and ω —
 * a k that followed energy(s) would fold against s exactly as the rotating
 * direction did, so energy buys amplitude and crossfades fixed-rate layers,
 * never the phase rate. A bend changes where the river is, not where it is
 * in its own cycle.
 *
 * TWO VARIANTS, ONE SOURCE. All of the above compiles only under
 * HYDRO_FLOWING (the material variant standing on river cells); the ocean
 * variant contains no river machinery and reads no structure texture, so
 * the open sea pays nothing for the river's correctness.
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
 *
 * RICHNESS CAME BACK ON THE SAME TERMS. Once the geometry, the coast and the
 * scheduling stopped moving, detail was restored — but every term added had
 * to name the rule it survives by. The shoaling harmonic is PHASE-LOCKED to
 * the shore wave (a harmonic of a continuous phase is continuous; a second
 * independent phase would fold). The flow streaks are anisotropic noise —
 * long along the current, short across it — which is real structure the
 * quantiser locks onto, at rippling-water contrast, advected downstream; on
 * standing water the same machinery becomes wind streaks and earns its keep
 * twice. The lapping foam PULSES with the shore-wave phase, so the water's
 * edge breathes with the crests that feed it instead of wearing a static
 * fringe. Spilling crests whiten just seaward of the breaker band, gated by
 * the same fragment noise as the breakers so the surf zone stays broken
 * patches. Mid-energy rivers get BOIL — luminance mottling, not white —
 * because a reach below the foam threshold is textured water, not paint.
 * Everything here lives inside the near-water branch; the far path did not
 * get one instruction more expensive.
 */

export const HYDRO_VERTEX_SHADER = /* glsl */`
precision highp float;

uniform sampler2D uHydroGeometry;
uniform sampler2D uHydroDynamics;
uniform sampler2D uHydroMaterial;
#ifdef HYDRO_FLOWING
uniform sampler2D uHydroStructure;
#endif
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
varying float vShorePhase;
varying float vSurfaceWave;
varying float vSurfaceEnergy;
varying float vShoal;

#include <common>
#include <fog_pars_vertex>

void main() {
  vHydroUv = uv * uFieldUv.xy + uFieldUv.zw;
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);

  float flowLength = length(dynamics.xy);
#ifdef HYDRO_FLOWING
  vFlowing = smoothstep(0.2, 0.72, flowLength);
#else
  // The standing variant compiles no river machinery. A texel that claims
  // to flow inside it (one pixel of bleed where the two variants' meshes
  // meet) is drawn as standing water rather than reaching for a phase this
  // variant does not have.
  vFlowing = 0.0;
#endif
  // dynamics.w is settled reach energy for flowing water and sea state for
  // standing water. dynamics.z remains physical fetch.
  float energy = clamp(dynamics.w, 0.0, 1.0);
  float fetchM = max(1.0, dynamics.z);
  vTurbulence = vFlowing * smoothstep(0.20, 0.78, energy);

  float depth = max(0.0, geometryField.a);
  float signedShoreDist = geometryField.g;
  float shoreDist = max(0.0, signedShoreDist);
  // Only ocean and lagoon coverage carries the terrain-relative coastal ramp.
  // Reading the already-bound material field at vertices lets the cheap
  // run-up approximation remain coastal rather than pulsing every pond bank.
  float vertexKind = floor(texture2D(uHydroMaterial, vHydroUv).r * 255.0 + 0.5);
  float coastalStanding = (1.0 - vFlowing)
    * step(0.5, vertexKind) * (1.0 - step(2.5, vertexKind));

  vec4 renderPosition = modelMatrix * vec4(position, 1.0);
  vAbsoluteXZ = renderPosition.xz + uWorldOrigin.xz;

  // ── BODY SCALE BELONGS TO GEOMETRY ──
  //
  // A production ocean tile is 2.4km wide and the default mesh is 32 cells:
  // roughly 75m between vertices. The old 9-34m displacement could not exist
  // on that lattice. Geometric wavelength is now fetch-scaled and never below
  // 38m for small, tightly meshed bodies; open-ocean swell is ~300m: four
  // production cells per dominant wave, rather than the barely perceptible
  // 360m sheet, while remaining above the lattice's aliasing floor. The
  // fragment still owns all shorter structure.
  float speed = max(0.2, uWind.z);
  float fetchScale = clamp(log2(max(fetchM, 80.0) / 80.0) / 8.0, 0.0, 1.0);
  float wavelength = mix(38.0, 300.0, fetchScale) * max(0.2, uWaveLength);
  float k = 6.28318530718 / wavelength;
  float omega = 0.34 + speed * 0.055;
  vec2 windDir = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 windCross = vec2(-windDir.y, windDir.x);
  vec2 secondaryDir = normalize(windDir + windCross * 0.46);

  // Each phase has one constant direction. Their amplitudes mix; their
  // directions never vary inside dot(p,d), preserving the fingerprint fix.
  float swellA = sin(dot(vAbsoluteXZ, windDir) * k - uTime * omega);
  float swellB = sin(dot(vAbsoluteXZ, secondaryDir) * k * 1.62
    - uTime * omega * 1.14 + 1.7);
  float swell = swellA * 0.74 + swellB * 0.26;

  // Shore-following geometry is also macro scale. The 5-30m crest structure
  // belongs in the analytic normal and foam response, not a 75m vertex grid.
  float shoreWavelength = max(72.0, wavelength * 0.42);
  float shoreK = 6.28318530718 / shoreWavelength;
  float shorePhase = shoreDist * shoreK + uTime * omega * 0.86;
  float steepen = 1.0 - smoothstep(0.8, 4.5, depth);
  float shoreWave = sin(shorePhase)
    + sin(shorePhase * 2.0) * 0.24 * steepen;
  float nearShore = (1.0 - smoothstep(22.0, 120.0, shoreDist))
    * (1.0 - vFlowing);
  float standingWave = mix(swell, shoreWave, nearShore);
  vShorePhase = sin(shorePhase);

#ifdef HYDRO_FLOWING
  // ── RIVER HEAVE LIVES IN RIVER SPACE ──
  // The phase is wavenumber × s − ω × t and nothing else. It used to be
  // dot(worldPosition, flowDirection(texel)); a direction that turns along
  // the channel inside a phase FOLDS it, and every bend wore the concentric
  // fingerprint the sea shader was rewritten to remove. "s" is distance
  // along the river — continuous by construction, continuous across tile
  // fragments — so the heave turns with the channel. k and ω are CONSTANTS:
  // energy buys amplitude below, never phase rate, because k(energy(s))·s
  // folds exactly as a rotating direction did. Broad heave only; fast
  // riffle/rapid structure is added analytically per fragment.
  vec4 structureField = texture2D(uHydroStructure, vHydroUv);
  float riverK = 6.28318530718 / (150.0 * max(0.2, uWaveLength));
  float riverPhase = structureField.r * riverK - uTime * 0.62;
  float riverWave = sin(riverPhase) * 0.72
    + sin(riverPhase * 0.57 + structureField.g * 2.4 + 1.9) * 0.28;
  float wave = mix(standingWave, riverWave, vFlowing);
#else
  float wave = standingWave;
#endif

  // ── SHOAL, BREAK, THEN COLLAPSE ──
  float breakerDepth = mix(0.55, 2.7, energy);
  float depthDelta = (depth - breakerDepth) / max(0.28, breakerDepth * 0.48);
  vBreaker = (1.0 - vFlowing) * exp(-depthDelta * depthDelta) * geometryField.r;
  vShoal = (1.0 - vFlowing)
    * (1.0 - smoothstep(breakerDepth, max(breakerDepth + 0.1, 10.0), depth));
  float postBreak = mix(0.28, 1.0,
    smoothstep(0.12, max(0.3, breakerDepth * 0.85), depth));

  vWaveCrest = smoothstep(0.48, 0.94, standingWave) * (1.0 - vFlowing);

  // Macro volume remains with distance. Only fragment-scale skin is allowed
  // to fade. Body roughness supplies persistent swell, but wind now opens the
  // range substantially: the previous linear multiplier compressed calm sea,
  // moderate weather and gale into variations of the same shallow sheet.
  float windSea = smoothstep(0.5, 15.0, speed);
  float standingState = clamp(energy * (0.50 + windSea * 0.75), 0.0, 1.0);
  float standingAmplitude = mix(0.012, 0.72, pow(standingState, 1.60))
    * (1.0 + vShoal * 0.62) * postBreak;
  float riverAmplitude = mix(0.006, 0.16, pow(energy, 1.35));
  float amplitude = mix(standingAmplitude, riverAmplitude, vFlowing)
    * uWaveAmplitude;

  vSurfaceWave = clamp(wave, -1.0, 1.0);
  vSurfaceEnergy = clamp(amplitude / mix(0.55, 0.15, vFlowing), 0.0, 1.0);
  float displaced = wave * amplitude * geometryField.r;

  // ── THE EXISTING COASTAL RAMP CAN LAP BEFORE A SURF STRIP EXISTS ──
  // Ocean coverage already extends over a narrow terrain-relative edge band:
  // for those texels coverage ~= level - ground + 0.35. The fixed 0.5 cut
  // threw that information away. During an advancing shore phase, lift only
  // the dry half of that coastal band by the encoded bank rise so fragments
  // admitted by the moving cut sit just above the terrain instead of remaining
  // depth-occluded below it. This is deliberately a bounded approximation;
  // proper bore, swash and backwash geometry belongs to the deferred strip.
  float dryCoast = coastalStanding * (1.0 - step(0.0, signedShoreDist));
  float edgeEvidence = smoothstep(0.01, 0.18, geometryField.r)
    * (1.0 - smoothstep(0.48, 0.72, geometryField.r));
  float lapAdvance = smoothstep(-0.20, 0.88, sin(shorePhase));
  float encodedBankRise = clamp(0.35 - geometryField.r, 0.0, 0.34);
  float runupLift = dryCoast * edgeEvidence * lapAdvance
    * (encodedBankRise + 0.025) * clamp(uShoreFade, 0.2, 2.0);
  renderPosition.y = uElevationBase + geometryField.b - uWorldOrigin.y
    + displaced + runupLift;

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
#ifdef HYDRO_FLOWING
uniform sampler2D uHydroStructure;
#endif
uniform float uTime;
uniform vec3 uWind;
uniform float uRain;
uniform vec4 uRig;
uniform float uRigWade;
uniform vec3 uSunDirection;
uniform vec3 uSkyColour;
uniform vec3 uTerrainColour;
uniform float uDebugView;
uniform float uRippleStrength;
uniform float uFoamStrength;
uniform float uShoreFade;
uniform vec2 uHydroTexel;
uniform vec2 uFieldMeters;

varying vec2 vHydroUv;
varying vec2 vAbsoluteXZ;
varying vec3 vRenderPosition;
varying float vWaveCrest;
varying float vBreaker;
varying float vTurbulence;
varying float vFlowing;
varying float vShorePhase;
varying float vSurfaceWave;
varying float vSurfaceEnergy;
varying float vShoal;

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

// Exact world-space derivative of the two ripple components. This costs the
// same two transcendental evaluations as rippleHeight did, but remains stable
// across camera projection, discard edges and the final low-resolution pass.
vec2 rippleGradient(vec2 p, vec2 flow, vec2 wind, float scale, float seed) {
  float speed = max(0.2, uWind.z);
  vec2 direction = length(flow) > 0.15 ? normalize(flow) : wind;
  vec2 crossDirection = vec2(-direction.y, direction.x);
  vec2 capillaryDirection = normalize(direction + crossDirection * 0.57);
  float kSmall = mix(2.8, 0.55, scale);
  float kCapillary = mix(5.8, 1.1, scale);
  float pSmall = dot(p, direction) * kSmall
    - uTime * (1.7 + speed * 0.12) + seed * 6.283;
  float pCapillary = dot(p, capillaryDirection) * kCapillary
    - uTime * (2.5 + speed * 0.08) + 2.1;
  float amplitude = mix(0.012, 0.1, scale) * uRippleStrength;
  return (direction * cos(pSmall) * kSmall * 0.68
    + capillaryDirection * cos(pCapillary) * kCapillary * 0.32) * amplitude;
}

#ifdef HYDRO_FLOWING
// The river's ripple normal, phased in river space: "s" metres downstream,
// "crossM" metres off the centreline. The gradient DIRECTION may follow the
// local tangent freely — direction only aims the normal — but the phase
// inside the cosines never contains a spatially varying direction or rate.
// The wavenumbers are FIXED, unlike the standing version's energy-scaled
// ones: sea state is one value per body, so k(scale) is constant there,
// but river energy varies along the reach and k(energy(s))·s would fold.
// Energy buys amplitude here; the energetic look comes from the facet,
// boil and foam terms.
vec2 rippleGradientRiver(float s, float crossM, vec2 flow, float energy, float seed) {
  vec2 direction = normalize(flow + vec2(0.00001, 0.0));
  vec2 crossDirection = vec2(-direction.y, direction.x);
  float pSmall = s * 1.5 - uTime * 1.9 + seed * 6.283;
  float pCapillary = (s * 0.62 + crossM * 0.79) * 3.2 - uTime * 2.7 + 2.1;
  float amplitude = mix(0.012, 0.1, energy) * uRippleStrength;
  return (direction * cos(pSmall) * 1.5 * 0.68
    + crossDirection * cos(pCapillary) * 3.2 * 0.32) * amplitude;
}
#endif

void main() {
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  vec4 materialField = texture2D(uHydroMaterial, vHydroUv);
  float kind = floor(materialField.r * 255.0 + 0.5);
  // ── A HARD CUT, BUT NO LONGER A FROZEN COAST ──
  //
  // The composite still owns dithering: this remains one binary alpha test,
  // never a stippled transparency edge. Ocean and lagoon texels in the partial
  // terrain-aware coastal ramp move that cut with the legal shore-distance
  // phase. Broad world-anchored set noise prevents an entire coastline moving
  // as a ruler. Rivers and inland banks retain the exact 0.5 physics/visual
  // threshold; only the explicitly coastal transition departs from it.
  float coverageCut = 0.5;
  bool coastalKind = kind > 0.5 && kind < 2.5;
  bool partialCoast = coastalKind && geometryField.r > 0.005
    && geometryField.r < 0.9 && geometryField.g < 0.0;
  if (partialCoast) {
    float setEnvelope = valueNoise(vAbsoluteXZ * 0.0042
      + vec2(uTime * 0.018, -uTime * 0.009));
    float phaseDrive = smoothstep(-0.24, 0.88, vShorePhase)
      * mix(0.78, 1.08, setEnvelope);
    float lapExtent = clamp(uShoreFade * 0.5, 0.1, 1.0);
    float retreatCut = mix(0.54, 0.68, lapExtent);
    float advanceCut = mix(0.34, 0.10, lapExtent);
    coverageCut = mix(retreatCut, advanceCut, clamp(phaseDrive, 0.0, 1.0));
  }
  if (geometryField.r < coverageCut) discard;
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  float seed = materialField.g;
  float turbidity = materialField.b;
  float energy = clamp(dynamics.w, 0.0, 1.0);
#ifdef HYDRO_FLOWING
  // River space, texel-accurate — the mesh lattice can be wider than the
  // whole channel, so "n" has to come from the field, not from a varying.
  // This is the one extra texture read the flowing variant costs.
  vec4 riverField = texture2D(uHydroStructure, vHydroUv);
  float riverS = riverField.r;
  float riverCross = riverField.g * max(riverField.a, 1.0);
  // Bends work their outer bank: pressure piles up on the outside of the
  // turn, the inner lane slackens. Signs as the CPU packs them — n from
  // cross(tangent, offset), curvature from cross(u1, u2) — make the outer
  // bank the side where curvature × n is NEGATIVE.
  float outerBank = clamp(0.5 - riverField.b * riverField.g * 60.0, 0.0, 1.0);
#endif

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

  // ── THREE BANDS, THREE LIFETIMES ──
  // Body displacement never fades here. Structure and skin fade smoothly,
  // and the expensive path still ends around 875m, preserving the recovered
  // full-ocean cost. foamLod reaches full strength sooner than the old raw
  // distance multiplier, so nearby rapids and breakers survive quantisation.
  float camDist = distance(cameraPosition, vRenderPosition);
  float detailFade = 1.0 / (1.0 + camDist * 0.006);
  bool nearWater = detailFade > 0.16;
  float detailLod = smoothstep(0.16, 0.34, detailFade);
  float foamLod = smoothstep(0.16, 0.26, detailFade);

  vec2 wind = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 flow = dynamics.xy;
  vec3 normal = vec3(0.0, 1.0, 0.0);
  if (nearWater) {
#ifdef HYDRO_FLOWING
    vec2 gradient = vFlowing > 0.5
      ? rippleGradientRiver(riverS, riverCross, flow, energy, seed)
      : rippleGradient(vAbsoluteXZ, flow, wind, energy, seed);

    // Mid-energy rivers need working volume before they earn white foam.
    // Two analytic, flow-aligned slopes create broken riffle/boil facets;
    // unlike colour bands, these respond to light and never trace the banks.
    if (vFlowing > 0.5 && energy > 0.16) {
      vec2 flowDirection = normalize(flow + vec2(0.00001, 0.0));
      vec2 acrossDirection = vec2(-flowDirection.y, flowDirection.x);
      float work = smoothstep(0.16, 0.72, energy) * (0.7 + 0.6 * outerBank);
      // Two FIXED-RATE layers — a riffle and a rapid — crossfaded by energy.
      // Crossfading the cosines keeps both phases continuous; crossfading
      // the phases (or scaling k by energy, as this used to) folds where
      // energy changes along the reach.
      float slowFacet = cos(riverS * 0.22 - uTime * 1.2 + seed * 4.1);
      float fastFacet = cos(riverS * 0.40 - uTime * 2.7 + seed * 4.1);
      float facet = mix(slowFacet, fastFacet, smoothstep(0.3, 0.8, energy));
      float acrossPhase = riverCross * 0.35
        + sin(riverS * 0.103 - uTime * 0.56) * 1.3;
      gradient += flowDirection * facet * work * (0.045 + energy * 0.13);
      gradient += acrossDirection * cos(acrossPhase) * work * (0.025 + energy * 0.07);
    }
#else
    vec2 gradient = rippleGradient(vAbsoluteXZ, flow, wind, energy, seed);
#endif
    gradient = clamp(gradient, vec2(-2.0), vec2(2.0))
      * (1.0 + vTurbulence * 0.62) * detailLod;
    normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  }

  // ── VISUAL DEPTH, SEPARATED FROM RAW BATHYMETRY ──
  // Nearshore keeps the true depth so shoaling and the breaker band read;
  // offshore the colour depth becomes a smooth function of shore distance,
  // because DEM bathymetry mapped patch-by-patch into colour is camouflage.
  float shoreDist = max(0.0, geometryField.g);
  float offshore = smoothstep(15.0, 70.0, shoreDist) * (1.0 - vFlowing);
  // The shallow-to-deep ramp is BROAD — uniform only past ~450m — so the
  // transition itself is structure the quantiser can render as bands.
  float visualDepth = mix(min(geometryField.a, 14.0),
    min(3.0 + shoreDist * 0.022, 14.0), offshore);

  vec3 colour = palette(kind, visualDepth, turbidity);

  // Geometry supplies the cheapest and most important structure signal.
  // Give its crest/trough enough tonal separation to cross a palette rung,
  // while broad random variation recedes into a supporting role.
  float bodyTone = vSurfaceWave * mix(0.035, 0.13, vSurfaceEnergy)
    * mix(1.0, 1.18, vFlowing);
  float shoalCrest = (1.0 - vFlowing) * vShoal
    * smoothstep(0.34, 0.94, vSurfaceWave) * 0.075;
  colour *= 1.0 + bodyTone + shoalCrest;

  float grain = 0.5;
  if (nearWater) {
#ifdef HYDRO_FLOWING
    // The river's grain advects in river space at a CONSTANT rate. It used
    // to slide world noise along the per-texel flow vector, which is
    // differential advection: neighbouring fragments on a bend sample
    // ever-more-distant noise as time passes, and the texture shears into
    // shimmer. One rate in s cannot shear.
    grain = vFlowing > 0.5
      ? valueNoise(vec2(riverS * 0.12 - uTime * 0.5, riverCross * 0.4 + seed * 7.0))
      : valueNoise(vAbsoluteXZ * mix(0.28, 0.055, energy)
        + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
#else
    grain = valueNoise(vAbsoluteXZ * mix(0.28, 0.055, energy)
      + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
#endif
    colour *= 1.0 + (grain - 0.5) * 0.14 * detailLod;
    // ── STREAKS: LONG WITH THE CURRENT, SHORT ACROSS IT ──
    // The single strongest read a river has — elongated luminance lanes
    // sliding downstream — and on standing water the same term, steered by
    // the wind, becomes wind streaks. Anisotropic noise is real structure
    // at rippling-water contrast, so the quantiser renders lanes instead of
    // inventing them; the 11:1 stretch is what says "moving water" at a
    // glance. Kept low: this shades the surface, it does not stripe it.
    // A river's lanes run in (s, n) now, so a lane FOLLOWS ITS BEND instead
    // of shearing off it on the world axis it was projected onto.
    float along = dot(vAbsoluteXZ, wind);
    float acrossStreak = dot(vAbsoluteXZ, vec2(-wind.y, wind.x));
    float streakRate = 0.35;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) { along = riverS; acrossStreak = riverCross * 0.7; streakRate = 1.35; }
#endif
    float streak = valueNoise(vec2(along * 0.045 - uTime * streakRate,
      acrossStreak * 0.5 + seed * 9.0));
    float streakAmp = mix(smoothstep(3.0, 10.0, uWind.z) * 0.05,
      (0.05 + energy * 0.06), vFlowing);
    colour *= 1.0 + (streak - 0.5) * streakAmp * detailLod;
  }
  // ── A FLAT FIELD DOES NOT SURVIVE THE QUANTISER ──
  //
  // Perfectly uniform deep water sits at one value for kilometres, and when
  // that value lands near a palette boundary the post dither turns the whole
  // sea into a high-contrast maze — photographed from the seat off Hout Bay.
  // The cure is not less variation but MORE, of the right kind: broad
  // (90-320m), low-contrast, world-anchored and nearly static, so the
  // quantiser locks onto real structure and different reaches of sea settle
  // onto different palette rungs instead of one giant threshold field. This
  // is the "broad, low-contrast variation" the analysis called for, and it
  // must never be sharpened or sped up — fast or fine variation here would
  // crawl under the dither.
  float broad = valueNoise(vAbsoluteXZ * 0.0031 + vec2(seed * 3.0, 7.0)) * 0.6
    + valueNoise(vAbsoluteXZ * 0.011 - vec2(uTime * 0.015, 0.0)) * 0.4;
  // Rivers get the broad term too, at half weight: a long reach was one flat
  // ribbon for kilometres, which is the same quantiser trap the sea fell
  // into, only narrower. Half, because a river's width gives the dither less
  // room to spread a threshold than open water has.
  colour *= 1.0 + (broad - 0.5) * 0.10 * mix(1.0, 0.5, vFlowing);

  // ── ONE CONTINUOUS ENVIRONMENT, NOT DAY/NIGHT PALETTES ──
  //
  // The previous narrow smoothstep around the horizon was numerically smooth
  // but visually categorical after quantisation: the whole river crossed a
  // palette rung together at dawn and dusk. Solar contribution now rolls over
  // a much broader altitude range, while sky reflection and shallow terrain
  // tint remain present at every hour. No branch says "night".
  vec3 lightDirection = normalize(uSunDirection);
  vec3 viewDirection = normalize(cameraPosition - vRenderPosition);
  float solarT = clamp((lightDirection.y + 0.22) / 0.82, 0.0, 1.0);
  float daylight = solarT * solarT * (3.0 - 2.0 * solarT);
  float ambientLevel = mix(0.12, 0.82, daylight);
  float directLight = max(0.0, dot(normal, lightDirection)) * daylight;
  colour *= ambientLevel + directLight * 0.26;

  // Scene fog is the horizon/sky proxy already maintained by Three. Explicit
  // frame colour can refine it without making integration mandatory.
  vec3 horizonColour = uSkyColour;
#ifdef USE_FOG
  horizonColour = mix(uSkyColour, fogColor, 0.62);
#endif
  float nightSkyEnergy = mix(0.10, 1.0, daylight);
  vec3 reflectedSky = horizonColour * nightSkyEnergy;
  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnel = 0.055 + 0.34 * pow(1.0 - facing, 3.0);
  colour = mix(colour, reflectedSky, fresnel);

  // In shallow/turbid water the bed and banks tint the returning light. This
  // is continuous environmental coupling, not a second time-of-day colour.
  float terrainCoupling = (1.0 - smoothstep(0.45, 4.5, geometryField.a))
    * mix(0.08, 0.28, turbidity);
  colour = mix(colour,
    uTerrainColour * mix(0.18, 0.9, daylight),
    terrainCoupling);

  if (nearWater) {
    // The glint is broad and quiet. A narrow bright crest highlight is what
    // the quantiser promotes into white wave diagrams at low sun. Sparkle
    // comes from MODULATING that quiet lobe by the advected grain.
    float glint = pow(max(0.0, dot(reflect(-lightDirection, normal), viewDirection)), 9.0);
    float sparkle = 0.55 + 0.9 * smoothstep(0.45, 0.85, grain);
    colour += vec3(1.0, 0.9, 0.7) * glint * sparkle * 0.11 * daylight * detailLod;
  }

  // ── FOAM IS PAID FOR ONLY WHERE FOAM CAN EXIST ──
  // Near water AND in a place that can hold any: the breaker band, an
  // energetic river reach, the last few metres of shore, rain, or a gale.
  // The open calm sea — most of every coastal frame — pays nothing, which
  // with the derivative normals above is the difference the frame counter
  // was reporting between the hydro sea and the legacy plane's flat colour.
  bool foamZone = vBreaker > 0.02 || vTurbulence > 0.01 || uRain > 0.05
    || geometryField.g < 22.0 || uWind.z > 9.5
    // A mid-energy reach earns entry for BOIL — mottling, not white — and a
    // shoaling crest for its spilling top. Both are cheap and both are the
    // texture that made "the river lacks detail" true.
    || (vFlowing > 0.5 && energy > 0.22)
    || (vWaveCrest > 0.6 && geometryField.a < 6.0);
  if (nearWater && foamZone) {
    // ── FOAM: SPARSE, CAUSAL, BRIEF ──
    // Standing water keeps the fixed world axes it always fragmented on
    // (flow there is ~zero, so the old normalize degenerated to +x anyway);
    // a river's foam runs in (s, n) so a streak of it rides its own bend.
    float downstream = vAbsoluteXZ.x;
    float across = vAbsoluteXZ.y;
    float foamRate = 0.72 + energy * 1.1;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) {
      downstream = riverS;
      across = riverCross;
      // CONSTANT advection: an energy-scaled rate is differential advection
      // along the reach, and the streak field shears apart over time.
      foamRate = 1.35;
    }
#endif
    // Reach energy already carries a distance-based downstream memory from
    // build-tile. Foam remains causal and persistent without two more texture
    // reads in every rapid fragment.
    float causalEnergy = energy;
    float energyGate = smoothstep(0.55, 0.82, causalEnergy);
    float foamStreak = valueNoise(vec2(downstream * 0.16 - uTime * foamRate,
      across * 0.31 + seed * 13.0));
    float riverFoam = vFlowing * energyGate
      * smoothstep(0.64, 0.89, foamStreak + grain * 0.12) * 0.72;
    // ── BOIL: THE TEXTURE OF WATER THAT IS WORKING BUT NOT BREAKING ──
    // Below the white-foam threshold a reach still churns; that reads as
    // luminance mottling riding the same advected streak field the foam
    // uses, never as white. This is what stands between "calm ribbon" and
    // "rapids" — the middle of the river's expressive range.
    float boil = vFlowing * smoothstep(0.18, 0.5, causalEnergy) * (1.0 - energyGate);
#ifdef HYDRO_FLOWING
    // The outside of a bend churns and whitens first — curvature × n.
    riverFoam *= 0.6 + 0.8 * outerBank;
    boil *= 0.7 + 0.6 * outerBank;
#endif
    float workingWater = (foamStreak - 0.5) * 0.74 + (grain - 0.5) * 0.26;
    colour *= 1.0 + workingWater * boil * 0.30 * detailLod;
    // Breakers: crests inside the narrow depth band, spatially fragmented so
    // the surf zone is broken white patches rather than a shoreline outline.
    float crestPick = smoothstep(0.6, 0.92, vWaveCrest);
    float fragmentNoise = smoothstep(0.42, 0.72,
      valueNoise(vec2(across * 0.14 + seed * 7.0, downstream * 0.05 - uTime * 0.3)));
    float breakerFoam = (1.0 - vFlowing) * vBreaker * crestPick * fragmentNoise;
    // ── SPILLING CRESTS, JUST SEAWARD OF THE BREAK ──
    // Shoaling steepens a crest before the depth band catches it; its top
    // whitens faintly as it comes in. Gated by the same fragment noise as
    // the breakers so the pre-surf stays broken patches, and by depth so
    // open-water crests never wear it.
    float spill = (1.0 - vFlowing) * smoothstep(0.78, 0.98, vWaveCrest)
      * (1.0 - smoothstep(2.2, 6.0, geometryField.a)) * fragmentNoise * 0.35;
    // Residual surf-zone foam: sparse flecks — PULSED by the shore wave, so
    // the waterline breathes with the crests that feed it. The floor keeps
    // the trough from wiping the zone clean; a static fringe and a bare
    // shore are both wrong.
    float lapPulse = 0.35 + 0.65 * smoothstep(-0.2, 0.9, vShorePhase);
    float shoreFoamWidth = mix(7.0, 24.0, energy) * max(0.05, uShoreFade);
    float lappingFoam = (1.0 - vFlowing)
      * (1.0 - smoothstep(1.0, shoreFoamWidth, shoreDist))
      * smoothstep(0.70, 0.88, valueNoise(vAbsoluteXZ * 0.18 + vec2(0.0, uTime * 0.22)))
      * lapPulse * 0.46;
    float whitecap = (1.0 - vFlowing) * smoothstep(9.5, 17.0, uWind.z)
      * energy * crestPick * fragmentNoise * 0.5;
    float rainPocks = smoothstep(0.42, 0.9, valueNoise(vAbsoluteXZ * 0.72 - uTime * 1.8)) * uRain;
    float foam = clamp((lappingFoam + riverFoam + breakerFoam * 0.8 + spill
      + whitecap + rainPocks * 0.14) * uFoamStrength, 0.0, 0.82) * foamLod;
    // Foam takes the scene's light too — white paint at midnight is a bug.
    vec3 foamColour = vec3(0.84, 0.9, 0.88) * mix(0.14, 1.0, daylight);
    colour = mix(colour, foamColour, foam);
  }

  // ── THE WATER ANSWERS THE HULL ──
  //
  // When the rig is actually wading (uRigWade > 0, a fact the drive model
  // already computes), the surface responds: churned white around the hull,
  // rings spreading from it, and a pair of trailing arms once it is moving.
  // Every phase here is a function of DISTANCE TO THE RIG — a distance field,
  // continuous by construction, the same legality argument as the shore
  // wave. Dry frames skip the whole block on one uniform test, and the
  // response fades inside ~26m, so it costs nothing except where the story
  // is happening.
  if (uRigWade > 0.02 && nearWater) {
    vec2 toHere = vAbsoluteXZ - uRig.xy;
    float rigDist = length(toHere);
    if (rigDist < 26.0) {
      float rigSpeed = length(uRig.zw);
      float sub = smoothstep(0.02, 0.55, uRigWade);
      // Churn: the displaced collar at the hull, wider and whiter with speed.
      float churn = (1.0 - smoothstep(1.2, 5.0, rigDist)) * (0.3 + min(rigSpeed, 8.0) * 0.09);
      // Rings: crests expanding from the hull, dying with distance. Fordings
      // are slow, so the rings are what read; at speed the arms take over.
      float ringWave = sin(rigDist * 2.1 - uTime * 5.5);
      float rings = smoothstep(0.55, 0.95, ringWave)
        * (1.0 - smoothstep(3.0, 16.0, rigDist)) * 0.32
        * (1.0 - smoothstep(2.0, 6.0, rigSpeed));
      // Arms: two trailing streaks behind the velocity, the pixel-art cousin
      // of a Kelvin wake. Only while moving; fragmented by the water's own
      // grain so they read as churned water, not drawn lines.
      float arms = 0.0;
      if (rigSpeed > 1.2) {
        vec2 vDir = uRig.zw / rigSpeed;
        float behind = dot(toHere, -vDir);
        float lateral = abs(dot(toHere, vec2(-vDir.y, vDir.x)));
        arms = (1.0 - smoothstep(0.6, 2.2, abs(lateral - behind * 0.38)))
          * smoothstep(0.5, 2.5, behind) * (1.0 - smoothstep(6.0, 24.0, behind))
          * smoothstep(0.35, 0.7, grain) * 0.45;
      }
      float wake = clamp((churn + rings + arms) * sub, 0.0, 0.8) * foamLod;
      vec3 wakeFoam = vec3(0.84, 0.9, 0.88) * mix(0.14, 1.0, daylight);
      colour = mix(colour, wakeFoam, wake);
    }
  }

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
