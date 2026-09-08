import { BANK_GLSL } from '../shoreline';
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
  // A swell arrives in sets. The envelope travels more slowly than the
  // crests and varies amplitude only, preserving continuous wave phase.
  float waveSet = 0.82 + 0.18 * sin(dot(vAbsoluteXZ, windDir) * k * 0.23 - uTime * omega * 0.31);
  float swell = (swellA * 0.74 + swellB * 0.26) * waveSet;

  // Shore-following geometry is also macro scale. The 5-30m crest structure
  // belongs in the analytic normal and foam response, not a 75m vertex grid.
  float shoreWavelength = max(72.0, wavelength * 0.42);
  float shoreK = 6.28318530718 / shoreWavelength;
  // Signed distance keeps the phase continuous through the waterline:
  // clamping the dry side to zero made every run-up vertex move in lockstep.
  float shorePhase = signedShoreDist * shoreK + uTime * omega * 0.86;
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
  float standingAmplitude = mix(0.012, 1.05, pow(standingState, 1.60))
    * (1.0 + vShoal * 0.62) * postBreak;
  float riverAmplitude = mix(0.006, 0.21, pow(energy, 1.35));
  float amplitude = mix(standingAmplitude, riverAmplitude, vFlowing)
    * uWaveAmplitude;

  vSurfaceWave = clamp(wave, -1.0, 1.0);
  vSurfaceEnergy = clamp(amplitude / mix(0.55, 0.15, vFlowing), 0.0, 1.0);
  float displaced = wave * amplitude * geometryField.r;

  // Only the shoreline-only fine mesh advances onto the dry coastal ramp.
  // Its coverage encodes level-ground+0.35, so the amount needed to clear the
  // bank is available without another terrain texture. The broad body remains
  // at its resting level and cannot become a second, coarse run-up sheet.
  float runupLift = 0.0;
#ifdef HYDRO_SURF
  float dryCoast = coastalStanding * (1.0 - step(0.0, signedShoreDist));
  float edgeEvidence = smoothstep(0.01, 0.14, geometryField.r)
    * (1.0 - smoothstep(0.56, 0.78, geometryField.r));
  float lapAdvance = smoothstep(-0.24, 0.88, sin(shorePhase));
  float encodedBankRise = clamp(0.35 - geometryField.r, 0.0, 0.34);
  runupLift = dryCoast * edgeEvidence * lapAdvance
    * (encodedBankRise + 0.045) * clamp(uShoreFade, 0.2, 2.0);
#endif
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
uniform vec4 uRigTrail[8];
uniform float uRigTrailCount;
uniform vec3 uSunDirection;
uniform vec3 uSkyColour;
uniform vec3 uSceneLight;
uniform vec3 uZenith;
uniform vec3 uTerrainColour;
uniform sampler2D uSwardCol;
uniform vec2 uSwardOrg;
uniform float uSwardW;
uniform float uDebugView;
uniform float uRippleStrength;
uniform float uFoamStrength;
uniform float uShoreFade;
uniform float uShallowBedStrength;
uniform float uRiverEdgeStrength;
uniform float uTurbulenceStrength;
uniform float uEddyStrength;
uniform vec2 uHydroTexel;
uniform vec2 uFieldMeters;
${BANK_GLSL}
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

// Recent wetted vehicle positions form a short wake polyline. Older points
// spread, drift with the local current and fade over fourteen seconds. XY is
// a normal slope and Z is water-coloured disturbance. Historical foam is
// deliberately absent: aeration belongs at the live hull, not in dotted
// capsules along every retained sample.
vec4 rigTrailField(vec2 p, vec2 flow) {
  vec2 slope = vec2(0.0);
  float evidence = 0.0;
  for (int i = 0; i < 7; i++) {
    if (uRigTrailCount < float(i) + 1.5) continue;
    vec4 a = uRigTrail[i];
    vec4 b = uRigTrail[i + 1];
    vec2 pa = a.xy + flow * a.z * 0.22;
    vec2 pb = b.xy + flow * b.z * 0.22;
    vec2 ab = pb - pa;
    float t = clamp(dot(p - pa, ab) / max(0.04, dot(ab, ab)), 0.0, 1.0);
    vec2 q = mix(pa, pb, t);
    vec2 away = p - q;
    float distanceM = length(away);
    float age = mix(a.z, b.z, t);
    float strength = mix(a.w, b.w, t);
    float life = (1.0 - smoothstep(1.0, 14.0, age)) * strength;
    float spread = 1.35 + age * 0.34;
    float body = (1.0 - smoothstep(spread, spread + 2.8, distanceM)) * life;
    float ring = cos(distanceM * 2.25 - age * 2.65);
    vec2 radial = away / max(0.16, distanceM);
    slope += radial * ring * body * 0.078;
    evidence = max(evidence, body * (0.72 + ring * 0.12));
  }
  return vec4(slope, evidence, 0.0);
}

// Water keeps a recognisable class palette, but its colour belongs to the
// landscape it is in. The original constants survived every biome unchanged,
// which made the same cyan cut-out run through a green dusk and an ochre desert.
// Match luminance later through the shared light response; here the terrain
// supplies hue and sediment, most strongly for wetlands and narrow watercourses.
// THE GROUND, WET. Every colour the water borrows from its bank — the first
// centimetre of a shallow, silt, a gravel bar, the damp margin — is the local
// ground darkened and greyed, never a sand constant: a grassland river has a
// dark green-grey bed and a desert river a pale one, because their banks do.
// The sward's bank paint applies the same rule on the ground side
// (bankMineralOf in main.ts), so the two meet in one colour at the waterline.
vec3 wetGround(vec3 t) {
  return mix(t, vec3(dot(t, vec3(0.333))), 0.22) * 0.78;
}

vec3 palette(float kind, float depth, float turbidity, vec3 terrainC) {
  vec3 shallow = vec3(0.14, 0.33, 0.36);
  vec3 deep = vec3(0.03, 0.115, 0.16);
  float groundAffinity = 0.12;
  if (kind > 9.5) {
    // wetland (kind 10) must be tested before the flowing range.
    shallow = vec3(0.20, 0.28, 0.20);
    deep = vec3(0.08, 0.14, 0.12);
    groundAffinity = 0.42;
  } else if (kind > 6.5 && kind < 9.5) {
    // river / stream / canal (kinds 7-9)
    shallow = vec3(0.15, 0.25, 0.23);
    deep = vec3(0.055, 0.125, 0.125);
    groundAffinity = 0.30;
  } else if (kind > 2.5 && kind < 6.5) {
    // lake / pond / reservoir / basin (kinds 3-6)
    shallow = vec3(0.16, 0.31, 0.28);
    deep = vec3(0.045, 0.14, 0.16);
    groundAffinity = 0.20;
  }
  vec3 wet = wetGround(terrainC);
  // Silt is the bank's own soil in suspension.
  shallow = mix(shallow, wet * 1.15, turbidity * 0.44);
  deep = mix(deep, wet * 0.55, turbidity * 0.32);
  if (kind > 2.5) {
    // INLAND, THE EDGE OF THE WATER IS THE WET GROUND. The shallow constant
    // stood at thirty percent ground and, lit by nothing but itself, drew a
    // rim at every waterline in the chart brighter than any bank — the
    // "beach" the seat saw around a grassland river at the Senqu. The first
    // centimetre is the bank, darkened; the water's own tint arrives with
    // depth, and sooner where silt hides the bottom.
    shallow = mix(wet, shallow, mix(0.35, 0.6, turbidity));
  } else {
    shallow = mix(shallow, terrainC * mix(0.92, 1.12, turbidity), groundAffinity);
  }
  deep = mix(deep, terrainC * 0.58, groundAffinity * 0.42);
  // Fresh water eats light faster than 0.5 a metre: at that constant a
  // river 1.3 m deep sat halfway to its deep colour and read from above as
  // a pale sage sandbar against dry grassland. Silt shortens the path.
  float attenuation = 1.0 - exp(-max(depth, 0.0) * mix(0.85, 0.30, turbidity));
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

// A bend sheds slow circulating cells on its inside bank. This returns the
// slope in local (downstream, cross-stream) coordinates and a signed tonal
// signal in Z. Cells have a fixed 58m chainage period: curvature controls
// amplitude and side, never phase rate, so a changing bend cannot fold or
// shear the pattern. Random activation and offset mean a bend gets one or two
// broad crescents, not a row of repeated whirlpool symbols.
vec3 riverEddyField(
  float s, float crossM, float halfWidth, float curvature, float energy, float seed
) {
  float bend = smoothstep(0.0012, 0.010, abs(curvature));
  float activeWater = smoothstep(0.08, 0.34, energy)
    * (1.0 - smoothstep(0.78, 0.98, energy));
  float side = curvature < 0.0 ? -1.0 : 1.0;
  float period = 58.0;
  float shiftedS = s + seed * 47.0;
  float cell = floor(shiftedS / period);
  float cellSeed = hash21(vec2(cell, floor(seed * 251.0) + 17.0));
  float activeCell = smoothstep(0.30, 0.76, cellSeed);
  float localS = mod(shiftedS, period) - period * 0.5
    + (cellSeed - 0.5) * 15.0;
  float centreCross = side * halfWidth * mix(0.48, 0.68, cellSeed);
  vec2 local = vec2(localS / 17.0,
    (crossM - centreCross) / max(3.2, halfWidth * 0.52));
  float radius = length(local);
  float envelope = (1.0 - smoothstep(0.32, 1.18, radius))
    * bend * activeWater * activeCell * clamp(uEddyStrength, 0.0, 3.0);
  vec2 tangent = vec2(-local.y, local.x) / max(0.12, radius);
  float phase = atan(local.y, local.x) + radius * 1.15
    - uTime * 0.34 + cellSeed * 6.283;
  float circulation = 0.62 + sin(phase) * 0.38;
  float tone = cos(phase + 0.9) * envelope;
  return vec3(tangent * circulation * envelope, tone);
}
#endif

void main() {
  vec4 geometryField = texture2D(uHydroGeometry, vHydroUv);
  vec4 materialField = texture2D(uHydroMaterial, vHydroUv);
  float kind = floor(materialField.r * 255.0 + 0.5);
  // One physical waterline, represented by two meshes. The broad body keeps
  // the stable 0.5 cutoff. Only the fine coastal strip moves below it during
  // run-up; on retreat it overlaps the body rather than exposing a gap.
  bool coastalKind = kind > 0.5 && kind < 2.5;
  // Declared outside the surf split because both the broad body and the
  // shoreline overlay use the same local ground colour later in the shader.
  // Keep the texture sample after discard so rejected surf fragments pay
  // nothing for it.
  vec3 terrainC = uTerrainColour;
#ifdef HYDRO_SURF
  if (!coastalKind || abs(geometryField.g) > 96.0) discard;
  float coverageCut = 0.5;
  bool partialCoast = geometryField.r > 0.005
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
#else
  // Coverage remains continuous until this one physical waterline. Dither
  // and palette quantisation belong to the global post pipeline; reproducing
  // either here creates a second, incompatible stipple at every river bank.
  // THE WATERLINE IS RAGGED, NOT RASTERED. Coverage ramps over about one
  // texel (18.75 m) and a single cut through it is a straight line the eye
  // reads as the raster it is. The shared bank patches (shoreline.ts, the
  // same noise the sward's banks use) move the cut by a few metres either
  // way, so the edge is the same broken line on both sides of it.
  if (geometryField.r < 0.5 + (bankPatch(vAbsoluteXZ) - 0.5) * 0.24) discard;
  // THE GROUND'S OWN COLOUR, HERE. uTerrainColour is the ground under the
  // truck; the sward's colour field is the palette at THIS fragment's XZ
  // wherever it reaches (a 768 m square around the truck), and the frame
  // colour stands in beyond it.
#endif
  if (uSwardW > 1.0) {
    vec2 su = (vAbsoluteXZ - uSwardOrg) / uSwardW;
    if (su.x > 0.0 && su.x < 1.0 && su.y > 0.0 && su.y < 1.0) {
      float inside = smoothstep(0.0, 0.05, min(min(su.x, 1.0 - su.x), min(su.y, 1.0 - su.y)));
      terrainC = mix(uTerrainColour, texture2D(uSwardCol, su).rgb, inside);
    }
  }
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  float seed = materialField.g;
  float turbidity = materialField.b;
  float energy = clamp(dynamics.w, 0.0, 1.0);
  // DEEP WATER IS CALM WATER. Reach energy is the profile's slope, and a
  // wide river carries the same drop with far less turbulence than a brook:
  // the Senqu at a hundred metres across was foam from bank to bank, a white
  // sheet from above, because every texel of it was scored as a 4% brook.
  // The depth the tile builder now gives a channel (see build-tile) calms
  // the foam, the rapids and the turbulence tone toward the middle; the
  // riffles stay at the shallow margins where they belong.
  energy *= mix(1.0, 0.3, smoothstep(0.9, 3.5, geometryField.a));
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
  // The bed's BROAD structure — bars and cobble beds, tens of metres — is
  // what the chart sees from four hundred metres up and what an aerial
  // photograph of any clear river is made of; only the pebbles and stones
  // alias at that range. So the bed outlives the skin by a band.
  float bedLod = smoothstep(0.05, 0.16, detailFade);
  // Grade supplies energy; depth decides whether that energy is a deep boil or
  // a shallow rapid. This is also the veil over the bed: aerated water hides
  // stones before turbid or deep water does.
  float shallowRapid = vFlowing * smoothstep(0.48, 0.80, energy)
    * (1.0 - smoothstep(0.62, 1.75, geometryField.a))
    * clamp(uTurbulenceStrength, 0.0, 3.0);
#ifdef HYDRO_FLOWING
  float riverEddyTone = 0.0;
#endif
  vec4 rigTrailResponse = vec4(0.0);
  float rigLiveTone = 0.0;

  vec2 wind = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 flow = dynamics.xy;
  vec3 macroNormal = vec3(0.0, 1.0, 0.0);
  // The broad wave must tilt the light as well as the silhouette. Evaluate
  // derivatives before per-fragment branches; fine ripples add to this slope.
  // WebGL1 without derivatives retains the previous analytic fallback.
#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)
  vec3 faceNormal = cross(dFdx(vRenderPosition), dFdy(vRenderPosition));
  if (faceNormal.y < 0.0) faceNormal = -faceNormal;
  macroNormal = normalize(faceNormal + vec3(0.0, 0.000001, 0.0));
#endif
  vec3 normal = macroNormal;
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
      float work = smoothstep(0.20, 0.78, energy) * (0.72 + 0.46 * outerBank)
        * clamp(uTurbulenceStrength, 0.0, 3.0);
      // Two FIXED-RATE layers — a riffle and a rapid — crossfaded by energy.
      // Crossfading the cosines keeps both phases continuous; crossfading
      // the phases (or scaling k by energy, as this used to) folds where
      // energy changes along the reach.
      float slowFacet = cos(riverS * 0.22 - uTime * 1.2 + seed * 4.1);
      float fastFacet = cos(riverS * 0.40 - uTime * 2.7 + seed * 4.1);
      float facet = mix(slowFacet, fastFacet, smoothstep(0.3, 0.8, energy));
      float acrossPhase = riverCross * 0.35
        + sin(riverS * 0.103 - uTime * 0.56) * 1.3;
      gradient += flowDirection * facet * work * (0.022 + energy * 0.060);
      gradient += acrossDirection * cos(acrossPhase) * work * (0.014 + energy * 0.032);

      // On bends, a slower circulating normal lives beside the downstream
      // riffles. It is strongest on the slack inside lane, while outer-bank
      // turbulence remains the faster, breaking response above.
      vec3 eddy = riverEddyField(
        riverS, riverCross, max(riverField.a, 1.0), riverField.b, energy, seed
      );
      gradient += (flowDirection * eddy.x + acrossDirection * eddy.y) * 0.14;
      riverEddyTone = eddy.z;
    }
#else
    vec2 gradient = rippleGradient(vAbsoluteXZ, flow, wind, energy, seed);
#endif
    if (uRigTrailCount > 1.5) {
      rigTrailResponse = rigTrailField(vAbsoluteXZ, flow);
      gradient += rigTrailResponse.xy;
    }
    if (uRigWade > 0.02) {
      vec2 fromRig = vAbsoluteXZ - uRig.xy;
      float rigDistance = length(fromRig);
      if (rigDistance < 24.0) {
        float rigSpeed = length(uRig.zw);
        float sub = smoothstep(0.02, 0.55, uRigWade);
        vec2 radial = fromRig / max(0.16, rigDistance);
        float ring = cos(rigDistance * 1.72 - uTime * (3.6 + rigSpeed * 0.12));
        float ringEnvelope = (1.0 - smoothstep(2.2, 18.0, rigDistance))
          * (1.0 - smoothstep(0.0, 2.0, rigDistance));
        gradient += radial * ring * ringEnvelope * sub * 0.075;
        if (rigSpeed > 0.3) {
          vec2 vDir = uRig.zw / rigSpeed;
          float ahead = dot(fromRig, vDir);
          float lateral = dot(fromRig, vec2(-vDir.y, vDir.x));
          float bow = (1.0 - smoothstep(0.8, 4.8, abs(ahead - 2.7)))
            * (1.0 - smoothstep(1.0, 5.5, abs(lateral)))
            * smoothstep(-0.6, 1.8, ahead);
          gradient += vDir * bow * sub * min(1.0, rigSpeed / 5.0) * 0.11;
          rigLiveTone = max(rigLiveTone, bow * sub * 0.7);
        }
        rigLiveTone = max(rigLiveTone, abs(ring) * ringEnvelope * sub * 0.34);
      }
    }
    // Rain disturbs the NORMAL, rather than painting white noise onto water.
    // Each world cell has one staggered ring; its radius dies before touching
    // the cell edge, so no neighbouring-cell search is needed. Only near,
    // relatively calm water resolves drops at this pixel scale.
    if (uRain > 0.02 && camDist < 90.0) {
      vec2 dropCell = floor(vAbsoluteXZ / 3.0);
      vec2 dropP = fract(vAbsoluteXZ / 3.0) - 0.5;
      float age = fract(uTime * 0.72 + hash21(dropCell));
      float radius = length(dropP);
      float ring = (radius - age * 0.42) * 38.0;
      float envelope = exp(-ring * ring * 0.18) * sin(age * 3.14159265)
        * (1.0 - smoothstep(0.35, 0.48, radius));
      gradient += dropP / max(0.02, radius) * sin(ring) * envelope
        * uRain * (1.0 - energy * 0.72) * (1.0 - smoothstep(30.0, 90.0, camDist)) * 0.16;
    }
    gradient = clamp(gradient, vec2(-2.0), vec2(2.0))
      * (1.0 + vTurbulence * 0.34 * clamp(uTurbulenceStrength, 0.0, 3.0))
      * detailLod;
    vec2 macroSlope = macroNormal.xz / max(0.25, macroNormal.y);
    normal = normalize(vec3(macroSlope.x - gradient.x, 1.0, macroSlope.y - gradient.y));
  }

  // ── ONE SHORE WETNESS SIGNAL ──
  //
  // Body colour, damp-bank coupling and foam all use this same continuous
  // coordinate. Width follows water-body context: ocean fetch earns a broad
  // shoal and 4-12m swash, inland standing water stays tighter, rivers keep a
  // narrow bank transition, and wetlands intermix broadly at low contrast.
  bool inlandStandingKind = kind > 2.5 && kind < 6.5;
  bool flowingKind = kind > 6.5 && kind < 9.5;
  bool wetlandKind = kind > 9.5;
  float fetchShape = clamp(log2(max(dynamics.z, 80.0) / 80.0) / 8.0, 0.0, 1.0);
  float shoalWidth = coastalKind ? mix(28.0, 62.0, fetchShape)
    : (inlandStandingKind ? mix(6.0, 20.0, fetchShape)
    : (wetlandKind ? mix(20.0, 38.0, turbidity) : 4.0));
  float swashWidth = coastalKind ? mix(4.0, 12.0, fetchShape)
    : (inlandStandingKind ? mix(2.0, 6.0, fetchShape)
    : (wetlandKind ? 7.0 : 1.5));
  swashWidth *= clamp(uShoreFade, 0.2, 2.0);
  float phaseAdvance = smoothstep(-0.24, 0.88, vShorePhase);
  float shoreCoordinate = geometryField.g
    + mix(-0.25, 0.65, phaseAdvance) * swashWidth;
  float distanceWet = smoothstep(-swashWidth, shoalWidth, shoreCoordinate);
  float depthTarget = coastalKind ? mix(2.2, 4.5, fetchShape)
    : (wetlandKind ? 0.8 : (inlandStandingKind ? 2.0 : 0.7));
  float depthWet = smoothstep(0.08, depthTarget, geometryField.a);
  float shoreWetness = clamp(distanceWet * mix(0.62, 1.0, depthWet), 0.0, 1.0);
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5 && flowingKind) {
    float channelWet = smoothstep(0.0, 0.30, 1.0 - abs(riverField.g));
    shoreWetness = mix(shoreWetness, channelWet, 0.82);
  }
#endif

  // ── VISUAL DEPTH, SEPARATED FROM RAW BATHYMETRY ──
  // Nearshore keeps true depth; offshore colour depth becomes a smooth shore
  // function so noisy DEM bathymetry cannot turn into camouflage.
  float shoreDist = max(0.0, geometryField.g);
  float offshore = smoothstep(15.0, 70.0, shoreDist) * (1.0 - vFlowing);
  float visualDepth = mix(min(geometryField.a, 14.0),
    min(3.0 + shoreDist * 0.022, 14.0), offshore);
  // A CHANNEL IS A TROUGH, NOT A SLAB. The field gives a river one depth per
  // texel — and the floor build-tile lays under a narrow ribbon gives every
  // texel of it the same 1.3 m — so from above the water was one flat tone
  // bank to bank with no bed in it. Across the channel the bed falls to the
  // thalweg: the margins are ankle-deep and show the ground through them,
  // the middle keeps the texel's depth and goes dark. This is the shape of
  // the bed, which is what the chart sees; the physics keeps the texel.
  float bedDepth = geometryField.a;
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5) {
    float across = clamp(abs(riverField.g), 0.0, 1.0);
    float trough = mix(0.18, 1.0, sqrt(max(0.0, 1.0 - across * across)));
    visualDepth *= trough;
    bedDepth *= trough;
  }
#endif
  // LOOKING DOWN, YOU LOOK DEEPER. From the bank the eye skims the surface
  // and the column it sees into is short; from straight above (the chart)
  // it is the whole depth twice. The palette's depth scales with the view's
  // overhead component, so the same river is its deep colour from the air
  // and its shallow colour from the seat.
  float overhead = clamp(normalize(cameraPosition - vRenderPosition).y, 0.0, 1.0);
  vec3 colour = palette(kind, visualDepth * (1.0 + 0.9 * overhead), turbidity, terrainC);

  // ── THE SHALLOW WATER HAS A FLOOR ──
  //
  // An opaque surface that only tints toward terrain still reads as a ribbon
  // laid over the valley. Clear, shallow water instead returns a stable bed:
  // broad sediment, finer pebble variation and darker cobble aggregates.
  // Flowing water evaluates the pattern in (s,n), so gravel bars turn with the
  // river; standing water uses world space. Turbidity, depth, rapid aeration
  // and distance all remove the detail continuously.
  if (nearWater) {
    float clearDepthM = mix(3.4, 0.72, turbidity);
    float bedVisibility = (1.0 - smoothstep(0.10, clearDepthM, bedDepth))
      * (1.0 - turbidity * 0.78) * bedLod
      * mix(0.62, 1.0, vFlowing) * (1.0 - shallowRapid * 0.48)
      * clamp(uShallowBedStrength, 0.0, 3.0);
    // Deep water and opaque silt skip every bed-noise evaluation.
    if (bedVisibility > 0.015) {
      vec2 bedP = vAbsoluteXZ;
      float grainScale = 1.0;
#ifdef HYDRO_FLOWING
      if (vFlowing > 0.5) {
        bedP = vec2(riverS, riverCross);
        float channelScale = clamp((riverField.a - 1.5) / 11.0, 0.0, 1.0);
        grainScale = mix(0.72, 1.55, channelScale);
      }
#endif
      float pebble = valueNoise(bedP * vec2(0.72, 0.96) / grainScale
        + vec2(seed * 11.0, 2.4));
      float bar = valueNoise(bedP * vec2(0.18, 0.29) / grainScale
        - vec2(5.2, seed * 7.0));
      // Broad gravel/sand patches survive the production camera and global
      // quantiser; the finer pebble signal takes over only when close.
      float gravelBar = valueNoise(bedP * vec2(0.062, 0.105) / grainScale
        + vec2(seed * 3.0, -4.6));
      float cobble = smoothstep(0.54, 0.79,
        valueNoise(bedP * vec2(0.22, 0.31) / grainScale
          + vec2(seed * 5.0, -8.0)));
      // Individual rounded stones at 1.5–3m scale. This is albedo structure,
      // not a coverage trick: the global post pass remains the only dither.
      vec2 stoneP = bedP / (vec2(2.4, 1.85) * grainScale);
      vec2 stoneCell = floor(stoneP);
      vec2 stoneCentre = vec2(
        hash21(stoneCell + vec2(seed * 19.0, 3.0)),
        hash21(stoneCell + vec2(7.0, seed * 23.0))
      );
      float stoneShape = 1.0 - smoothstep(0.17, 0.39,
        length((fract(stoneP) - stoneCentre) * vec2(1.0, 1.18)));
      float stonePick = smoothstep(0.42, 0.76,
        hash21(stoneCell + vec2(11.0, seed * 31.0)));
      float bedStone = stoneShape * stonePick;
      // The bed is the bank's own material: wet ground, and a bar's dry
      // top at most a touch lighter than the ground beside it. The sand
      // constants that stood here painted a beach into a grassland.
      vec3 sediment = mix(terrainC * 0.88, wetGround(terrainC),
        0.5 + turbidity * 0.3);
      vec3 paleGravel = mix(sediment, terrainC * 1.06, 0.34);
      // From above the bars and pools are the read, so their contrast opens
      // with the view's overhead component; the fine grain fades with range.
      vec3 bedColour = mix(sediment * mix(0.78, 0.64, overhead), paleGravel * mix(1.08, 1.16, overhead), gravelBar)
        * (0.94 + ((pebble - 0.5) * 0.30 + (bar - 0.5) * 0.24) * detailLod);
      // Cobble is a darker aggregate in the sediment, not an object silhouette.
      // Protruding rocks are real production geometry and carry the stronger read.
      vec3 cobbleColour = mix(sediment * 0.62, terrainC * 0.76, 0.38);
      bedColour = mix(bedColour, cobbleColour,
        cobble * mix(0.24, 0.12, turbidity) * (1.0 + 0.7 * overhead));
      bedColour = mix(bedColour, cobbleColour * 0.82,
        bedStone * mix(0.46, 0.22, turbidity) * detailLod);
      // THE BED IS SEEN THROUGH THE WATER, NOT BESIDE IT. The bed's colour
      // was mixed in as painted — dry sand at any depth it was visible at —
      // so a river a metre and a half deep read from above as a cream
      // sandbar, which is what the seat saw at the Senqu. Light to the bed
      // and back crosses the column twice, and water eats red long before
      // green and blue: at 1.3 m the bed keeps half its red and three
      // quarters of its blue and goes the dark olive a real riverbed is.
      // Silt shortens the path further.
      bedColour *= exp(-vec3(0.62, 0.30, 0.20) * bedDepth * (1.0 + turbidity * 2.5));
      colour = mix(colour, bedColour,
        clamp(bedVisibility * mix(0.84, 0.52, turbidity), 0.0, 0.86));
    }
  }

  // The edge is damp terrain becoming shallow water, never a separately dark
  // contact stripe. Depth and distance both contribute, so the transition
  // remains broad at an ocean and compact at a river or pond.
  vec3 dampTerrain = mix(
    terrainC * mix(0.78, 0.9, 1.0 - turbidity),
    colour,
    wetlandKind ? 0.34 : 0.22
  );
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5 && flowingKind) {
    // The last wet metre contains gravel bars, damp sediment and broken
    // reflected water rather than one dark contact stripe. This lies inside
    // the opaque surface and meets the physical coverage waterline at the bank.
    float bankNear = smoothstep(0.58, 1.06, abs(riverField.g));
    float bankGrain = valueNoise(vec2(
      riverS * 0.19 + seed * 13.0,
      riverCross * 2.7 - riverS * 0.027
    ));
    float bankBar = valueNoise(vec2(
      riverS * 0.052 - seed * 5.0,
      riverCross * 0.82 + riverS * 0.009
    ));
    float bankPatch = smoothstep(0.22, 0.78, bankGrain * 0.42 + bankBar * 0.58)
      * bankNear * detailLod * clamp(uRiverEdgeStrength, 0.0, 3.0);
    vec3 gravelBank = mix(
      terrainC * 0.72,
      wetGround(terrainC) * 1.1,
      0.28 + (1.0 - turbidity) * 0.18
    );
    colour = mix(colour, mix(dampTerrain, gravelBank, 0.52),
      clamp(bankPatch * 0.55, 0.0, 0.74));
  }
#endif
  float waterBlend = smoothstep(0.035, 0.96, shoreWetness);
  colour = mix(dampTerrain, colour, waterBlend);

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
#ifdef HYDRO_FLOWING
    // A small tonal counterpart lets an eddy read under diffuse light, when
    // its normal alone would disappear. It remains water-coloured and never
    // crosses into white foam.
    colour *= 1.0 + riverEddyTone * 0.09 * detailLod;
#endif
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
  // The old ten-percent range became only ±5% around the mean: below one
  // display-palette step once dusk lighting had reduced it, so distant water
  // collapsed back into one flat cut-out. This remains broad and continuous,
  // but now spans enough value to survive the composite. Rivers keep the
  // quieter half because their narrow width cannot distribute the dither.
  colour *= 1.0 + (broad - 0.5) * 0.28 * mix(1.0, 0.55, vFlowing);

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
  // ── THE WATER IS LIT BY THE LIGHT THE GROUND IS LIT BY ──
  //
  // This was a curve of its own — 0.82 of ambient for any sun above thirty
  // degrees and a quarter of a direct term — while the ground beside it is
  // a Lambert surface under the scene's sun, sky fill and cloud deck. On a
  // hazy morning the ground halved and the river did not, and the seat saw
  // a band at twice the luminance of its valley. uSceneLight is the
  // irradiance on a flat surface as a ratio to a clear noon, per channel
  // (the host computes it from the same lights the ground uses); the
  // ripple's facet still tilts the direct share, and the cloud deck's
  // shadow crosses the water where the host supplies its function.
  float facet = min(max(0.0, dot(normal, lightDirection)) / max(lightDirection.y, 0.1), 1.6);
  float shade = 1.0;
#ifdef HYDRO_SCENE_SHADE
  shade = sceneShade(vRenderPosition);
#endif
  vec3 sceneLight = uSceneLight * (0.77 + 0.26 * facet) * shade;
  colour *= sceneLight;

  // Scene fog is the horizon/sky proxy already maintained by Three. Explicit
  // frame colour can refine it without making integration mandatory.
  vec3 horizonColour = uSkyColour;
#ifdef USE_FOG
  horizonColour = mix(uSkyColour, fogColor, 0.62);
#endif
  // uSkyColour now carries the scene's already time-of-day-adjusted sky.
  // Multiplying it down to ten percent at night dimmed the same transition
  // twice and threw away its hue. Keep a restrained energy floor and a little
  // more reflection at steep camera angles so water belongs to the visible sky
  // without turning into a glossy mirror.
  float skyEnergy = mix(0.40, 1.0, daylight);
  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  // LOOKING DOWN, THE WATER REFLECTS THE ZENITH. The horizon colour served
  // every view angle, and from the chart that put the bright horizon band
  // in a surface whose mirror points straight up at the darkest sky there is.
  vec3 reflectedSky = mix(uZenith, horizonColour, pow(1.0 - facing, 0.5)) * skyEnergy * shade;
  float fresnel = 0.08 + 0.38 * pow(1.0 - facing, 3.0);
  // A turbulent river reflects the same sky over many unresolved microfacets,
  // which broadens and dims the return. Using the sea's mirror strength on the
  // analytic rapid facets made each one a pale card over the valley.
  fresnel *= mix(1.0, 0.58, vFlowing);
  colour = mix(colour, reflectedSky, fresnel);

  // In shallow/turbid water the bed and banks tint the returning light. This
  // is continuous environmental coupling, not a second time-of-day colour.
  float terrainCoupling = (1.0 - smoothstep(0.45, 4.5, bedDepth))
    * mix(0.08, 0.28, turbidity);
  colour = mix(colour,
    terrainC * sceneLight * 0.9,
    terrainCoupling);

  if (nearWater) {
    // The glint is broad and quiet. A narrow bright crest highlight is what
    // the quantiser promotes into white wave diagrams at low sun. Sparkle
    // comes from MODULATING that quiet lobe by the advected grain.
    float glint = pow(max(0.0, dot(reflect(-lightDirection, normal), viewDirection)), 9.0);
    float sparkle = 0.55 + 0.9 * smoothstep(0.45, 0.85, grain);
    colour += vec3(1.0, 0.9, 0.7) * glint * sparkle * 0.11
      * daylight * shade * detailLod * mix(1.0, 0.46, vFlowing);
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
    || shallowRapid > 0.02
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
    float energyGate = max(smoothstep(0.57, 0.84, causalEnergy),
      shallowRapid * 0.56);
    float foamStreak = valueNoise(vec2(downstream * 0.16 - uTime * foamRate,
      across * 0.31 + seed * 13.0));
    float foamBreak = smoothstep(0.54, 0.79,
      valueNoise(vec2(downstream * 0.43 - uTime * 1.78,
        across * 0.84 - seed * 9.0)));
    float riverFoam = vFlowing * energyGate
      * smoothstep(0.66, 0.90, foamStreak + grain * 0.10)
      * foamBreak * 0.54 * clamp(uTurbulenceStrength, 0.0, 3.0);
    // A second, shorter chop breaks shallow high-energy reaches into flecks.
    // Deep energetic water keeps boil and long streaks; it does not become a
    // uniformly white rapid merely because its profile is steep.
    float rapidChop = shallowRapid * smoothstep(0.58, 0.84,
      valueNoise(vec2(downstream * 0.28 - uTime * 1.72,
        across * 0.52 + seed * 5.0)));
    riverFoam = max(riverFoam, rapidChop * foamBreak * 0.22);
    // ── BOIL: THE TEXTURE OF WATER THAT IS WORKING BUT NOT BREAKING ──
    // Below the white-foam threshold a reach still churns; that reads as
    // luminance mottling riding the same advected streak field the foam
    // uses, never as white. This is what stands between "calm ribbon" and
    // "rapids" — the middle of the river's expressive range.
    float boil = vFlowing * smoothstep(0.18, 0.5, causalEnergy) * (1.0 - energyGate)
      * clamp(uTurbulenceStrength, 0.0, 3.0);
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
    // The crest breaks first; the spent wash remains briefly behind it.
    // It shares the shore phase and depth gate, not a second shore mesh.
    float spentWash = smoothstep(-0.75, 0.35, vShorePhase)
      * (1.0 - smoothstep(0.35, 0.92, vShorePhase));
    float breakerFoam = (1.0 - vFlowing) * vBreaker
      * max(crestPick, spentWash * 0.42) * fragmentNoise;
    // ── SPILLING CRESTS, JUST SEAWARD OF THE BREAK ──
    // Shoaling steepens a crest before the depth band catches it; its top
    // whitens faintly as it comes in. Gated by the same fragment noise as
    // the breakers so the pre-surf stays broken patches, and by depth so
    // open-water crests never wear it.
    float spill = (1.0 - vFlowing) * smoothstep(0.78, 0.98, vWaveCrest)
      * (1.0 - smoothstep(2.2, 6.0, geometryField.a)) * fragmentNoise * 0.35;
    // Swash foam is a texture inside the SAME wetness band used by the body
    // colour and moving cutoff. It may break into flecks, but it cannot form a
    // detached second shoreline with a dark moat between itself and the sea.
    float lapPulse = 0.30 + 0.70 * phaseAdvance;
    float swashBand = smoothstep(0.045, 0.20, shoreWetness)
      * (1.0 - smoothstep(0.64, 0.92, shoreWetness));
    float swashTexture = mix(0.30, 1.0, smoothstep(0.50, 0.84,
      valueNoise(vAbsoluteXZ * 0.18 + vec2(0.0, uTime * 0.22))));
    float lappingFoam = (1.0 - vFlowing) * swashBand * swashTexture
      * lapPulse * (coastalKind ? 0.48 : 0.20);
    float whitecap = (1.0 - vFlowing) * smoothstep(9.5, 17.0, uWind.z)
      * energy * crestPick * fragmentNoise * 0.5;
    float foam = clamp((lappingFoam + riverFoam + breakerFoam * 0.8 + spill
      + whitecap) * uFoamStrength, 0.0, 0.82) * foamLod;
    // Foam takes the scene's light too — white paint at midnight is a bug.
    vec3 foamColour = vec3(0.84, 0.9, 0.88) * sceneLight;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) {
      // River aeration carries the water's own hue. Pure sea-foam white made a
      // rapid read as paint laid over its bed and bank.
      foamColour = mix(colour * 1.18, foamColour, 0.56);
    }
#endif
    colour = mix(colour, foamColour, foam);
  }

  // ── THE WATER ANSWERS THE HULL ──
  //
  // The live hull makes the immediate collar and arms; the retained trail
  // leaves spreading, downstream-drifting evidence after the rig climbs out.
  // Most old disturbance is water-coloured. Only its young broken core foams.
  if ((uRigWade > 0.02 || uRigTrailCount > 1.5) && nearWater) {
    vec2 toHere = vAbsoluteXZ - uRig.xy;
    float rigDist = length(toHere);
    float liveFoam = 0.0;
    if (uRigWade > 0.02 && rigDist < 26.0) {
      float rigSpeed = length(uRig.zw);
      float sub = smoothstep(0.02, 0.55, uRigWade);
      float fragments = smoothstep(0.38, 0.74,
        valueNoise(vAbsoluteXZ * 0.54 - uTime * vec2(0.13, 0.21)));
      // Aeration belongs immediately beside the body: a fragmented collar,
      // side splashes and a short stern churn. The spreading rings and wake
      // arms are normal/tonal structure above, not white paint.
      float churn = (1.0 - smoothstep(1.1, 4.2, rigDist))
        * (0.26 + min(rigSpeed, 8.0) * 0.055) * fragments;
      float sideSplash = 0.0;
      float stern = 0.0;
      if (rigSpeed > 1.2) {
        vec2 vDir = uRig.zw / rigSpeed;
        float along = dot(toHere, vDir);
        float lateral = abs(dot(toHere, vec2(-vDir.y, vDir.x)));
        sideSplash = (1.0 - smoothstep(0.18, 1.0, abs(lateral - 1.8)))
          * (1.0 - smoothstep(2.2, 4.8, abs(along)))
          * smoothstep(-2.8, 1.6, along) * fragments * 0.34;
        stern = (1.0 - smoothstep(0.8, 3.4, length(toHere + vDir * 2.4)))
          * smoothstep(0.42, 0.74, grain) * 0.42;
      }
      liveFoam = clamp((churn + sideSplash + stern) * sub, 0.0, 0.72);
    }
    colour *= 1.0 + (rigTrailResponse.z * 0.24 + rigLiveTone * 0.08) * detailLod;
    float wake = clamp(liveFoam, 0.0, 0.76) * foamLod;
    vec3 wakeFoam = vec3(0.84, 0.9, 0.88) * sceneLight;
    colour = mix(colour, wakeFoam, wake);
  }

  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
