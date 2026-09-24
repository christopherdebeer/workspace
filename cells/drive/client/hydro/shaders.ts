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
#ifdef HYDRO_FALLS
uniform sampler2D uHydroFalls;
#endif
precision highp float;

uniform sampler2D uHydroGeometry;
uniform sampler2D uHydroDynamics;
uniform sampler2D uHydroMaterial;
#ifdef HYDRO_FLOWING
uniform sampler2D uHydroStructure;
#endif
#ifdef HYDRO_COAST
uniform sampler2D uHydroCoast;
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
uniform float uWaveChop;
uniform float uShoreFade;
uniform float uLookModel;

varying vec2 vHydroUv;
varying vec2 vAbsoluteXZ;
varying vec3 vRenderPosition;
varying float vWaveCrest;
varying float vBreaker;
varying float vTurbulence;
varying float vFlowing;
varying float vShorePhase;
varying float vShoreCycle;
varying float vSurfaceWave;
varying float vSurfaceEnergy;
varying float vShoal;
varying float vExposure;
/** 0 beach, 1 shingle, 2 rock platform, 3 cliff, 4 sheltered inlet. */
varying float vCoastProfile;
varying vec4 vCoastWeights;

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
  // ── THE NEARSHORE PHASE RIDES TRAVEL TIME, NOT DISTANCE ──
  // Shore distance is continuous, so its isolines were the crests: a first
  // approximation that draws a crest the same sixty metres off a steep rock
  // shore and off a shelving beach, and wraps a headland in contour lines.
  // A real crest slows where the water shallows. The coast field (build-
  // tile, coast-field.ts) carries the travel time from the waterline over
  // the bathymetry in DEEP-WATER METRES — the same continuous coordinate
  // with refraction in it: equal to the distance where the water is deep,
  // growing faster over a shoal so the crests bunch and turn parallel to the
  // beach as they come in, bending round a headland instead of wrapping it.
  // The dry side keeps signed shore distance (the run-up phase is untouched)
  // and the two meet at zero on the waterline, so the phase stays
  // continuous — direction is still never inside it. Its alpha is EXPOSURE,
  // how much open sea the texel's seaward fan reaches: a harbour behind its
  // arm is quiet, a bay is half, an open beach breaks at full height.
#ifdef HYDRO_COAST
  vec4 coast = texture2D(uHydroCoast, vHydroUv);
  float phaseCoord = signedShoreDist < 0.0 ? signedShoreDist : max(0.0, coast.r);
  float exposure = clamp(coast.a, 0.0, 1.0);
#else
  float phaseCoord = signedShoreDist;
  float exposure = 1.0;
#endif
  vExposure = exposure;
  // Only ocean and lagoon coverage carries the terrain-relative coastal ramp.
  // Reading the already-bound material field at vertices lets the cheap
  // run-up approximation remain coastal rather than pulsing every pond bank.
  vec4 vertexMaterial = texture2D(uHydroMaterial, vHydroUv);
  float vertexKind = floor(vertexMaterial.r * 255.0 + 0.5);
  float coastalStanding = (1.0 - vFlowing)
    * step(0.5, vertexKind) * (1.0 - step(2.5, vertexKind));
  float vertexFlags = floor(vertexMaterial.a * 255.0 + 0.5);
  float coastBankClass = mod(floor(vertexFlags / 64.0), 4.0);
  float coastSlopeEvidence = depth / max(2.0, shoreDist);
  vCoastProfile = 0.0;
  if (coastalStanding > 0.5) {
    if (exposure < 0.34) vCoastProfile = 4.0;
    else if (coastBankClass > 2.5) {
      vCoastProfile = coastSlopeEvidence > 0.14 ? 3.0 : 2.0;
    } else if (coastBankClass > 1.5) vCoastProfile = 1.0;
  }
  float beachProfile = 1.0 - step(0.5, abs(vCoastProfile - 0.0));
  float shingleProfile = 1.0 - step(0.5, abs(vCoastProfile - 1.0));
  float platformProfile = 1.0 - step(0.5, abs(vCoastProfile - 2.0));
  float cliffProfile = 1.0 - step(0.5, abs(vCoastProfile - 3.0));
  float inletProfile = 1.0 - step(0.5, abs(vCoastProfile - 4.0));
  // The profile is a CATEGORY per vertex. Interpolated as a number, a beach
  // vertex (0) beside an inlet vertex (4) passed through shingle, platform
  // and cliff inside the triangle: straight-edged wedges of the wrong coast.
  // One-hot weights interpolate into a blend instead (inlet = the remainder).
  vCoastWeights = vec4(beachProfile, shingleProfile, platformProfile, cliffProfile);

  // ── THE SEA HAS NO SOUNDINGS, AND THE BREAK GATES MUST NOT BELIEVE ITS
  //    DEPTH ──
  //
  // Terrarium encodes open water as ZERO, not as bathymetry, so a sea
  // texel's depth is the resting datum minus that zero: 0.40 m at Camps Bay
  // — at every sample out to a kilometre and a half, measured with __wave.
  // Every gate below reads that number in metres, so the whole Atlantic sat
  // permanently in the post-break collapse (postBreak 0.32, vShoal pinned at
  // 1, and a breaker band that could never form because the depth delta's
  // exponential was 0.045). It cost half the wave: 0.347 m of peak rise
  // where the same sea state in deep water gives about 0.67.
  //
  // So the WAVE terms read an ordinary beach profile instead of the fill:
  // zero at the waterline and one in seventeen seaward. That slope is a
  // rendering proxy, chosen so the whole profile — wash, break, shoal, deep
  // — fits inside the 180 m the shore-distance field can actually measure
  // (it clamps there): the wash is the first forty metres, the break lands
  // around forty-three, the shoaling boost fades by a hundred and eighty,
  // and past that the sea is deep and the swell is its own honest height.
  // The DEEPER of the two always wins, so a tile that does carry soundings
  // keeps them and nothing is ever made shallower than the data says.
  // Coastal standing water only: a mountain lake's basin IS real land data
  // and a river owns its channel. Contact, colour and the bed are untouched;
  // this is only the geometry's idea of how far down the bottom is.
  float profileDepth = shoreDist * (
    beachProfile * 0.06
    + shingleProfile * 0.105
    + cliffProfile * 0.22
    + inletProfile * 0.05
  );
  // A rock platform stays shallow across its bench, then drops at the ledge.
  // This is deliberately a profile, not another shoreline-noise multiplier.
  float platformShelf = shoreDist * 0.035;
  float platformDrop = 1.35 + max(0.0, shoreDist - 38.0) * 0.16;
  profileDepth += platformProfile * mix(
    platformShelf, platformDrop, smoothstep(32.0, 52.0, shoreDist)
  );
  float waveDepth = mix(depth, max(depth, profileDepth), coastalStanding);
  // LOOK: a body mapped without bathymetry carries a nominal few centimetres
  // everywhere (0.08 m across Lake Bled), so the whole lake sat in the
  // breaker band and wore surf foam cut into triangles by these per-vertex
  // terms. Offshore, waves see the same shore-derived depth the fragment's
  // colour already uses (visualDepth).
  if (uLookModel > 0.5) {
    float offshoreV = smoothstep(15.0, 70.0, shoreDist) * (1.0 - vFlowing);
    waveDepth = mix(waveDepth, max(waveDepth, min(3.0 + shoreDist * 0.022, 14.0)), offshoreV);
  }

  vec4 renderPosition = modelMatrix * vec4(position, 1.0);
  vAbsoluteXZ = renderPosition.xz + uWorldOrigin.xz;

  // ── BODY SCALE BELONGS TO GEOMETRY ──
  //
  // Coastal bodies receive a denser lattice than rivers (system.ts), so the
  // open sea no longer has to stretch one wave over four enormous triangles.
  // Small bodies retain the 38m floor; the dominant swell is the number that
  // was measured, twice, and moved.
  //
  // A SEA THAT LOOKS FLAT IS NOT SHORT OF AMPLITUDE, IT IS SHORT OF
  // STEEPNESS. Reported from the seat as no vertex height at all, offshore,
  // at dusk, with the quantiser and the dither turned off. The vertex path
  // was proved sound first and the proof is worth keeping: hiding the hydro
  // mesh, the sea plane and the far shell in turn showed the visible water
  // IS this mesh, and the amplitude dial at 1x, 4x and 8x — the last of them
  // 23.6m of wave height — all read as a flat plate. The same 8x with the
  // wavelength quartered heaves. So height was never the lever.
  //
  // ── THE WAVE THIS WIND ACTUALLY MAKES IS SHORTER THAN THE MESH ──
  //
  // Fetch-limited, at the 12.6 m/s and 50 km this sea state stands for:
  // Hs 1.44 m at a peak period of 5.35 s, which is a wavelength of FORTY-FIVE
  // METRES and a slope Hs/L of 0.032. Production's coastal lattice is 21.1 m
  // between vertices — Nyquist is 42 m — so the honest wavelength is exactly
  // the one this mesh cannot carry, and no amount of tuning changes that.
  //
  // SO THE WAVE IS DRAWN LONG AND THE SLOPE IS KEPT, because slope is what
  // the eye reads and length is what it forgives. 140 m is 6.6 samples a
  // wave (a crest drawn at 89% of its height wherever the phase falls);
  // the amplitude below then puts H/L at 0.032, the real sea's own. THE
  // STATED COST is that the wave is about three times too TALL for its wind
  // — a right slope on a wrong length has to be. That is a judgement, and it
  // is the one the seat asked for: at 240 m the same sea stood at H/L 0.012,
  // a gradient of one in eighty, which is a level floor with a slow tilt in
  // it and no face anywhere to catch a low sun.
  //
  // MATCH THE REAL SLOPE; DO NOT BEAT IT. A first cut stood at H/L 0.042 —
  // the reasoning being that the quantiser eats shallow gradients, so lean
  // past the truth — and there is no evidence for that and one good argument
  // against: this sea is already three times too tall, and a slope chosen by
  // taste is a number nobody can ever check. 0.032 is checkable.
  //
  // (The frame that first argued for backing it off argued wrongly, and the
  // trap is worth the line: the surf station's photographs came back from
  // INSIDE the water column, which read as a crest swallowing the camera.
  // It was not. The probe prints the body's height beside the resting
  // surface now, and at that station the rig stands on a seabed 5.8 m down
  // whatever the sea is doing — the camera is under water in the control
  // too. A frame is evidence of what is in it, not of why.)
  float speed = max(0.2, uWind.z);
  float fetchScale = clamp(log2(max(fetchM, 80.0) / 80.0) / 8.0, 0.0, 1.0);
  float wavelength = mix(38.0, 140.0, fetchScale) * max(0.2, uWaveLength);
  float k = 6.28318530718 / wavelength;
  float omega = 0.34 + speed * 0.055;
  float windSea = smoothstep(0.5, 15.0, speed);
  // Sea state carries established swell. Local wind changes its height, but
  // cannot halve an energetic ocean merely because the beach is currently
  // under a light breeze; wind contributes the shorter skin and chop below.
  float standingState = clamp(energy * (0.78 + windSea * 0.42), 0.0, 1.0);
  vec2 windDir = normalize(uWind.xy + vec2(0.00001, 0.0));
  vec2 windCross = vec2(-windDir.y, windDir.x);
  vec2 secondaryDir = normalize(windDir + windCross * 0.46);
  vec2 windWaveDir = normalize(windDir - windCross * 0.34);
  // 0.32 of the dominant is 45m now, which the lattice cannot carry, so the
  // floor is what this layer actually is: 72m, 3.4 samples a wave, the
  // shortest wave on the production tier whose crest does not pulse badly as
  // it travels. The shore wave below sits on the same floor for the same
  // reason.
  float windWaveLength = max(72.0, wavelength * 0.32);
  float windWaveK = 6.28318530718 / windWaveLength;

  // Each phase has one constant direction. Their amplitudes mix; their
  // directions never vary inside dot(p,d), preserving the fingerprint fix.
  float swellPhaseA = dot(vAbsoluteXZ, windDir) * k - uTime * omega;
  float swellPhaseB = dot(vAbsoluteXZ, secondaryDir) * k * 1.62
    - uTime * omega * 1.14 + 1.7;
  float windWavePhase = dot(vAbsoluteXZ, windWaveDir) * windWaveK
    - uTime * (omega * 1.72 + 0.16) + 4.1;
  float swellA = sin(swellPhaseA);
  float swellB = sin(swellPhaseB);
  // A swell arrives in sets. The envelope travels more slowly than the
  // crests and varies amplitude only, preserving continuous wave phase.
  float waveSet = 0.82 + 0.18 * sin(dot(vAbsoluteXZ, windDir) * k * 0.23 - uTime * omega * 0.31);
  // THREE COASTAL RESPONSES, NOT ONE EXPOSURE MULTIPLIER. A headland or
  // harbour arm attenuates incoming swell; it does not switch off waves made
  // by the wind over the sheltered water itself, and neither of those is the
  // same question as whether a crest breaks. The coast field's open-sea fan
  // is sufficient evidence for the first split. Break response remains a
  // separate depth/exposure gate below.
  // LEANT ON HARDER WITH THE SHORTER SWELL. This is the only layer between
  // the dominant and the fragment skin that carries real faces, and at a
  // 140m dominant it is half the visible slope rather than a texture on top
  // of it: 0.26 to 0.56 of the swell's own amplitude by wind, against 0.20
  // to 0.42 before. Its own steepness stays mild (H/L about 0.019 at a fresh
  // wind) — what it adds is a second period, so a crest is not a single
  // hundred-metre roll with nothing on it.
  float swellTransmission = mix(0.34, 1.0, smoothstep(0.08, 0.82, exposure));
  swellTransmission = mix(1.0, swellTransmission, coastalStanding);
  float localWindTransmission = mix(0.68, 1.0, exposure);
  localWindTransmission = mix(1.0, localWindTransmission, coastalStanding);
  float windWaveWeight = (0.26 + windSea * 0.30)
    * smoothstep(0.10, 0.72, standingState);
  float swell = (swellA * 0.74 + swellB * 0.26) * waveSet
      * swellTransmission
    + sin(windWavePhase) * windWaveWeight * localWindTransmission;
  vec2 swellHorizontal = (
    windDir * cos(swellPhaseA) * 0.74
    + secondaryDir * cos(swellPhaseB) * 0.26
  ) * waveSet * swellTransmission
    + windWaveDir * cos(windWavePhase) * windWaveWeight
      * localWindTransmission;

  // Shore-following geometry is also macro scale. The 5-30m crest structure
  // belongs in the analytic normal and foam response, not a 75m vertex grid.
  float shoreWavelength = max(72.0, wavelength * 0.42);
  float shoreK = 6.28318530718 / shoreWavelength;
  // Signed distance keeps the phase continuous through the waterline:
  // clamping the dry side to zero made every run-up vertex move in lockstep.
  float shorePhase = phaseCoord * shoreK + uTime * omega * 0.86;
  float steepen = 1.0 - smoothstep(0.8, 4.5, waveDepth);
  float shoreWave = sin(shorePhase)
    + sin(shorePhase * 2.0) * 0.24 * steepen;
  // A cliff returns a restrained counter-phase rather than extending beach
  // run-up inland; a sheltered inlet retains local texture but little swell.
  shoreWave += sin(-shorePhase * 0.82 + 1.3) * 0.18 * cliffProfile;
  shoreWave *= mix(1.0, mix(0.30, 1.0, exposure), coastalStanding);
  // The coast field's direction points seaward. This phase travels toward
  // decreasing travel time, so its horizontal motion is shoreward.
#ifdef HYDRO_COAST
  vec2 shoreward = -normalize(coast.gb + vec2(0.00001, 0.0));
#else
  vec2 shoreward = windDir;
#endif
  vec2 shoreHorizontal = shoreward
    * (cos(shorePhase) + cos(shorePhase * 2.0) * 0.12 * steepen);
  // The crossfade to the shore wave rides the same coordinate, so over a
  // shoal the shore-following crests persist as far out as the slowing does.
  float shoreReach = beachProfile * 120.0
    + shingleProfile * 76.0
    + platformProfile * 94.0
    + cliffProfile * 44.0
    + inletProfile * 84.0;
  float nearShore = (1.0 - smoothstep(22.0, shoreReach, max(0.0, phaseCoord)))
    * (1.0 - vFlowing);
  float standingWave = mix(swell, shoreWave, nearShore);
  vec2 standingHorizontal = mix(swellHorizontal, shoreHorizontal, nearShore);
  vShorePhase = sin(shorePhase);
  vShoreCycle = shorePhase;

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
  float breakerDepth = mix(0.55, 2.7, energy) * (
    beachProfile
    + shingleProfile * 0.78
    + platformProfile * 0.68
    + cliffProfile * 0.56
    + inletProfile * 0.74
  );
  float depthDelta = (waveDepth - breakerDepth) / max(0.28, breakerDepth * 0.48);
  vBreaker = (1.0 - vFlowing) * exp(-depthDelta * depthDelta) * geometryField.r
    * mix(0.15, 1.0, exposure)
    * (1.0 + cliffProfile * 0.28 - inletProfile * 0.22);
  vShoal = (1.0 - vFlowing)
    * (1.0 - smoothstep(breakerDepth, max(breakerDepth + 0.1, 10.0), waveDepth));
  float postBreak = mix(0.28, 1.0,
    smoothstep(0.12, max(0.3, breakerDepth * 0.85), waveDepth));

  vWaveCrest = smoothstep(0.48, 0.94, standingWave) * (1.0 - vFlowing);

  // Macro volume remains with distance. Only fragment-scale skin is allowed
  // to fade. Established swell is primarily body state; current wind broadens
  // the range without erasing that swell during a lull.
  //
  // The ceiling rose with the wavelength above, and it is SOLVED from it
  // rather than chosen: at a full sea state the vertical envelope is
  // 1 + windWaveWeight = 1.54, so a ceiling of 1.45 m of peak rise reads as
  // 4.46 m of wave on a 140 m length — H/L 0.0319 against the fetch-limited
  // sea's own 0.0322 (the arithmetic is at the wavelength above). Well
  // inside the 1/7 a deep-water wave breaks at, and low enough that a
  // shoaling crest, which is this times 1.62, stays under the chase camera.
  // Raising this ALONE was measured and does nothing: see the wavelength.
  float standingAmplitude = mix(0.012, 1.45, pow(standingState, 1.60))
    * (1.0 + vShoal * 0.62) * postBreak;
  float riverAmplitude = mix(0.006, 0.21, pow(energy, 1.35));
  float amplitude = mix(standingAmplitude, riverAmplitude, vFlowing)
    * uWaveAmplitude;

  vec4 fallField = vec4(0.0);
#ifdef HYDRO_FALLS
  fallField = texture2D(uHydroFalls, vHydroUv);
  // A falling sheet does not heave like horizontal rapid water.
  amplitude *= 1.0 - fallField.r * 0.95;
#endif
  vSurfaceWave = clamp(wave, -1.0, 1.0);
  vSurfaceEnergy = clamp(amplitude / mix(0.55, 0.15, vFlowing), 0.0, 1.0);
  // Rivers meet a fixed bank: zero heave at the canonical coverage contour.
  float riverContact = smoothstep(0.5, 0.78, geometryField.r);
  float displaced = wave * amplitude * geometryField.r * mix(1.0, riverContact, vFlowing);
  // A vertical sine is a breathing sheet. Trochoidal horizontal displacement
  // makes the same continuous phases form narrower crests and broader troughs,
  // which gives the wave parallax and silhouette instead of merely changing
  // its colour. Rivers keep their own heave and receive none of this motion.
  float chopState = smoothstep(0.08, 0.86, standingState);
  float chopMetres = amplitude * mix(0.10, 0.82, chopState)
    * clamp(uWaveChop, 0.0, 3.0) * geometryField.r * (1.0 - vFlowing);
  renderPosition.xz += standingHorizontal * chopMetres;

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

#ifdef HYDRO_FALLS
  // A small downstream stand-off clears the independently triangulated
  // cliff skin. It is confined to known sheets and fades at lip/toe.
  renderPosition.xz += normalize(dynamics.xy + vec2(0.00001, 0.0)) * fallField.r * 0.65;
  renderPosition.y += fallField.r * 0.12;
#endif
  vRenderPosition = renderPosition.xyz;
  vec4 mvPosition = viewMatrix * renderPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const HYDRO_FRAGMENT_SHADER = /* glsl */`
#ifdef HYDRO_FALLS
uniform sampler2D uHydroFalls;
#endif
precision highp float;

uniform sampler2D uHydroGeometry;
uniform sampler2D uHydroDynamics;
uniform sampler2D uHydroMaterial;
#ifdef HYDRO_FLOWING
uniform sampler2D uHydroStructure;
#endif
#ifdef HYDRO_COAST
uniform sampler2D uHydroCoast;
#endif
uniform float uTime;
uniform vec3 uWorldOrigin;
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
uniform vec3 uGroundGain;
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
uniform float uAbsorptionStrength;
uniform float uScatteringStrength;
uniform float uSurfaceRoughness;
uniform float uLookModel;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColour;
uniform float uEdgeBlendEnabled;
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
varying float vShoreCycle;
varying float vSurfaceWave;
varying float vSurfaceEnergy;
varying float vShoal;
varying float vExposure;
/** 0 beach, 1 shingle, 2 rock platform, 3 cliff, 4 sheltered inlet. */
varying float vCoastProfile;
varying vec4 vCoastWeights;

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
  float sediment = 0.0;
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
    sediment = max(sediment, body
      * smoothstep(0.8, 3.0, age)
      * (1.0 - smoothstep(7.0, 14.0, age)));
  }
  return vec4(slope, evidence, sediment);
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
// (bankMineralColour in shoreline.ts), so the two meet in one colour at the waterline.
vec3 wetGround(vec3 t) {
  return mix(t, vec3(dot(t, vec3(0.333))), 0.22) * 0.78;
}

vec3 palette(float kind, float depth, float turbidity, vec3 terrainC) {
  float suspended = clamp(turbidity * uScatteringStrength, 0.0, 1.0);
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
  shallow = mix(shallow, wet * 1.15, suspended * 0.44);
  deep = mix(deep, wet * 0.55, suspended * 0.32);
  if (kind > 2.5) {
    // INLAND, THE EDGE OF THE WATER IS THE WET GROUND. The shallow constant
    // stood at thirty percent ground and, lit by nothing but itself, drew a
    // rim at every waterline in the chart brighter than any bank — the
    // "beach" the seat saw around a grassland river at the Senqu. The first
    // centimetre is the bank, darkened; the water's own tint arrives with
    // depth, and sooner where silt hides the bottom.
    shallow = mix(wet, shallow, mix(0.35, 0.6, suspended));
  } else {
    shallow = mix(shallow, terrainC * mix(0.92, 1.12, suspended), groundAffinity);
  }
  deep = mix(deep, terrainC * 0.58, groundAffinity * 0.42);
  // Fresh water eats light faster than 0.5 a metre: at that constant a
  // river 1.3 m deep sat halfway to its deep colour and read from above as
  // a pale sage sandbar against dry grassland. Suspended sediment SHORTENS
  // the visible path. The previous interpolation ran from 0.85 DOWN to 0.30,
  // contradicting this comment and the separate bed-visibility response:
  // turbid water took longer to reach its deep colour. Keep scattering in
  // the palette mixes above; this coefficient is absorption through depth.
  float absorption = mix(0.85, 1.55, turbidity)
    * clamp(uAbsorptionStrength, 0.0, 3.0);
  float attenuation = 1.0 - exp(-max(depth, 0.0) * absorption);
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
// TRANSPORTED MATERIAL HAS ONE CLOCK. Surface grain, long current lanes and
// foam used to imply unrelated downstream speeds because each multiplied s
// and time independently. Fetch is a body-constant width proxy on flowing
// water (line width ×5, or an area's characteristic diameter), so it can set
// one stable transport speed without differential advection inside a reach.
// Waves remain free to propagate relative to this coordinate; bed-anchored
// facets remain on raw s.
float riverTransportSpeed(float fetchM) {
  return clamp(0.55 + log2(max(fetchM, 12.0) / 12.0) * 0.22, 0.55, 2.2);
}

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
  float flagsByte = floor(materialField.a * 255.0 + 0.5);
  // Bits 3..5 carry the canonical bed class:
  // 1 silt, 2 sand, 3 gravel, 4 pebble, 5 rock.
  float bedClass = mod(floor(flagsByte / 8.0), 8.0);
  // Bits 6..7 carry bank material: 0 soil, 1 mud, 2 gravel, 3 rock.
  float bankClass = floor(flagsByte / 64.0);
  // Linear coverage can reach a texel whose nearest class is still unknown.
  // The CPU cannot call that water either; don't render an unclassified skirt.
  if (kind < 0.5) discard;
  // One physical waterline, represented by two meshes. The broad body keeps
  // the stable 0.5 cutoff. Only the fine coastal strip moves below it during
  // run-up; on retreat it overlaps the body rather than exposing a gap.
  bool coastalKind = kind > 0.5 && kind < 2.5;
  // Declared outside the surf split because both the broad body and the
  // shoreline overlay use the same local ground colour later in the shader.
  // Keep the texture sample after discard so rejected surf fragments pay
  // nothing for it.
  vec3 terrainC = uTerrainColour;
  float coverageInterior = 1.0;
  float recentlyWashed = 0.0;
#ifdef HYDRO_SURF
  bool surfHere = coastalKind;
  if (uLookModel > 0.5) {
    // LOOK: the swash strip belongs to coastal water, but deciding that per
    // NEAREST texel cut the overlay off in 18.75 m steps wherever the sea met
    // an estuary or lagoon (the staircase at the uMngeni mouth). Take the
    // bilinear share of coastal kinds and cut at half of it.
    vec2 tp = vHydroUv / uHydroTexel - 0.5;
    vec2 b0 = (floor(tp) + 0.5) * uHydroTexel;
    vec2 fr = fract(tp);
    vec4 k4 = floor(vec4(
      texture2D(uHydroMaterial, b0).r,
      texture2D(uHydroMaterial, b0 + vec2(uHydroTexel.x, 0.0)).r,
      texture2D(uHydroMaterial, b0 + vec2(0.0, uHydroTexel.y)).r,
      texture2D(uHydroMaterial, b0 + uHydroTexel).r) * 255.0 + 0.5);
    vec4 c4 = step(vec4(0.5), k4) * (1.0 - step(vec4(2.5), k4));
    vec4 w4 = vec4((1.0 - fr.x) * (1.0 - fr.y), fr.x * (1.0 - fr.y), (1.0 - fr.x) * fr.y, fr.x * fr.y);
    surfHere = dot(c4, w4) >= 0.5;
  }
  if (!surfHere || abs(geometryField.g) > 96.0) discard;
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
  // Two lagged wave phases retain the furthest recent wash. The surf mesh
  // can therefore leave a wet strip over exposed terrain for part of a wave
  // cycle instead of deleting it on the same frame the water retreats.
  float recentPhase = max(
    smoothstep(-0.24, 0.88, sin(vShoreCycle - 0.42)),
    smoothstep(-0.24, 0.88, sin(vShoreCycle - 0.84))
  );
  float recentCut = mix(0.68, 0.10,
    clamp(recentPhase * clamp(uShoreFade * 0.5, 0.1, 1.0), 0.0, 1.0));
  float retainedCut = min(coverageCut, recentCut);
  if (geometryField.r < retainedCut) discard;
  float wetUpper = max(retainedCut + 0.001,
    min(coverageCut, retainedCut + 0.12));
  recentlyWashed = step(geometryField.r, coverageCut)
    * smoothstep(retainedCut, wetUpper, geometryField.r);
#else
  // Coverage remains continuous until this one physical waterline. Dither
  // and palette quantisation belong to the global post pipeline; reproducing
  // either here creates a second, incompatible stipple at every river bank.
  // THE WATERLINE IS RAGGED, NOT RASTERED. Coverage ramps over about one
  // texel (18.75 m) and a single cut through it is a straight line the eye
  // reads as the raster it is. The shared bank patches (shoreline.ts, the
  // same noise the sward's banks use) move the cut by a few metres either
  // way, so the edge is the same broken line on both sides of it.
  // The coastal body shares the surf strip's 0.5 boundary; a ragged body
  // cut there would reveal a gap whenever the separate surf mesh retreats.
  // Terrain topology is constrained to the canonical 0.5 contour. Preserve a
  // little natural irregularity, but keep the rendered edge within roughly a
  // metre of that shared line at the production field tier.
  // River contact and CPU sampling share the exact canonical contour.
  float bodyCut = (coastalKind || vFlowing > 0.5) ? 0.5
    : 0.5 + (bankPatch(vAbsoluteXZ) - 0.5) * 0.08;
  if (geometryField.r < bodyCut) discard;
  // Coverage owns the literal fragment boundary. Signed distance and river N
  // are smooth physical coordinates, but their zeroes can sit between
  // different field samples after antialiasing. This ramp guarantees that
  // the first visible fragment at the cut carries ground, then becomes
  // shallow water continuously over the interior coverage shoulder.
  coverageInterior = smoothstep(bodyCut, min(0.98, bodyCut + 0.22), geometryField.r);
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
  // ── THE GROUND'S COLOUR, AS THE GROUND DRAWS IT ──
  //
  // What arrives above is ALBEDO — the terrain palette, the vertex colour
  // the Lambert ground multiplies by its light over π. Every colour this
  // shader keeps as a constant is a LIT colour at a clear noon. Mixing the
  // two as they came put a bank seen through a shallow, a gravel bar, the
  // damp margin, at three times the brightness of the bank beside them —
  // the cream rim at every waterline in the chart, ablation-proof because
  // it was in the palette itself. uGroundGain is the ground's own gain at
  // that noon (the host's irradiance over π), so from here the ground's
  // colour and the water's constants share one scale, and the scene light
  // below scales both alike.
  terrainC *= uGroundGain;
  vec4 dynamics = texture2D(uHydroDynamics, vHydroUv);
  float seed = materialField.g;
  float turbidity = materialField.b;
  // Neighbour kinds and their bilinear weights, for the palette blend below.
  vec4 lookKinds = vec4(kind);
  vec4 lookWeights = vec4(1.0, 0.0, 0.0, 0.0);
  if (uLookModel > 0.5) {
    // LOOK: the material field is NEAREST-sampled because kind and the bed /
    // bank classes are categories. Seed and turbidity are not: read through
    // that sampler, every 18.75 m texel boundary became a step in the water's
    // colour, the staircase polygons across a shelf or a river mouth. Rebuild
    // the two continuous channels bilinearly from the four texels around.
    vec2 texelPos = vHydroUv / uHydroTexel - 0.5;
    vec2 base = (floor(texelPos) + 0.5) * uHydroTexel;
    vec2 f = fract(texelPos);
    vec4 m00 = texture2D(uHydroMaterial, base);
    vec4 m10 = texture2D(uHydroMaterial, base + vec2(uHydroTexel.x, 0.0));
    vec4 m01 = texture2D(uHydroMaterial, base + vec2(0.0, uHydroTexel.y));
    vec4 m11 = texture2D(uHydroMaterial, base + uHydroTexel);
    // A neighbour that is not water (kind 0) carries no turbidity; weight it out.
    vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y)
      * step(vec4(0.5 / 255.0), vec4(m00.r, m10.r, m01.r, m11.r));
    float wSum = max(w.x + w.y + w.z + w.w, 1e-4);
    turbidity = dot(w, vec4(m00.b, m10.b, m01.b, m11.b)) / wSum;
    seed = dot(w, vec4(m00.g, m10.g, m01.g, m11.g)) / wSum;
    lookKinds = floor(vec4(m00.r, m10.r, m01.r, m11.r) * 255.0 + 0.5);
    lookWeights = w / wSum;
    // Bed and bank classes are ORDERED (silt < sand < gravel < pebble < rock;
    // soil < mud < gravel < rock) and every consumer reads them through
    // smoothsteps and |class - n| ramps, so a numeric blend is a gradual
    // change of material instead of a texel-shaped patch.
    vec4 flags4 = floor(vec4(m00.a, m10.a, m01.a, m11.a) * 255.0 + 0.5);
    bedClass = dot(lookWeights, mod(floor(flags4 / 8.0), 8.0));
    bankClass = dot(lookWeights, floor(flags4 / 64.0));
  }
  float suspendedScattering = clamp(turbidity * uScatteringStrength, 0.0, 1.0);
  float energy = clamp(dynamics.w, 0.0, 1.0);
  // DEEP FLOWING WATER IS CALM WATER. Reach energy is the profile's slope, and a
  // wide river carries the same drop with far less turbulence than a brook:
  // the Senqu at a hundred metres across was foam from bank to bank, a white
  // sheet from above, because every texel of it was scored as a 4% brook.
  // The depth the tile builder now gives a channel (see build-tile) calms
  // the foam, the rapids and the turbulence tone toward the middle; the
  // riffles stay at the shallow margins where they belong.
  // This correction used to run on standing water as well, quietly reducing
  // lake and ocean sea state according to basin depth. vFlowing is the regime
  // split for the shared dynamics.w channel; honour it here too.
  energy *= mix(1.0,
    mix(1.0, 0.3, smoothstep(0.9, 3.5, geometryField.a)),
    vFlowing);
  // Sheltered sea is calmer sea: the chop and its foam gates follow exposure
  // on standing water; a river's energy is its own.
  energy *= mix(0.55, 1.0, mix(vExposure, 1.0, vFlowing));
#ifdef HYDRO_FLOWING
  // River space, texel-accurate — the mesh lattice can be wider than the
  // whole channel, so "n" has to come from the field, not from a varying.
  // This is the one extra texture read the flowing variant costs.
  vec4 riverField = texture2D(uHydroStructure, vHydroUv);
  float riverS = riverField.r;
  float riverCross = riverField.g * max(riverField.a, 1.0);
  float riverTransport = riverS
    - uTime * riverTransportSpeed(max(12.0, dynamics.z));
  // Bends work their outer bank: pressure piles up on the outside of the
  // turn, the inner lane slackens. Signs as the CPU packs them — n from
  // cross(tangent, offset), curvature from cross(u1, u2) — make the outer
  // bank the side where curvature × n is NEGATIVE.
  float outerBank = clamp(0.5 - riverField.b * riverField.g * 60.0, 0.0, 1.0);
  // LOOK: n is normalised to the river LINE's half-width. A mapped water
  // area wider than that line (an estuary, a braided reach, a riverbank
  // polygon) sits at |n| > 1 almost everywhere, and the channel section read
  // all of it as bank: no wetness, an 8% visual depth and bank material
  // painted across the whole body. Beyond the ribbon the shore distance is
  // the truth.
  float beyondRibbon = uLookModel > 0.5 ? smoothstep(1.0, 1.25, abs(riverField.g)) : 0.0;
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
    } else if (uDebugView < 5.5) {
      float hue = fract(kind * 0.173 + 0.07);
      debugColour = 0.55 + 0.45 * cos(6.28318 * (hue + vec3(0.0, 0.67, 0.33)));
    } else {
      // THE COAST FIELD: exposure red→green, an isoline of travel every 30 m
      // (the crest lines the phase will draw), dry ground grey.
#ifdef HYDRO_COAST
      vec4 coast = texture2D(uHydroCoast, vHydroUv);
      float band = smoothstep(0.38, 0.5, abs(fract(coast.r / 30.0) - 0.5));
      debugColour = mix(vec3(0.75, 0.2, 0.15), vec3(0.15, 0.7, 0.35), coast.a) * mix(0.3, 1.0, band);
      if (geometryField.g < 0.0) debugColour = vec3(0.25);
#else
      debugColour = vec3(0.1, 0.1, 0.3);
#endif
    }
    gl_FragColor = vec4(debugColour, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }

  // ── THREE BANDS, THREE PROJECTED LIFETIMES ──
  // Body displacement never fades here. Structure and skin retain distance
  // ceilings, but their decisive gate is projected metres per render pixel:
  // the same riffle should survive further in a chart view when it still owns
  // pixels, and retire sooner at a grazing angle when it aliases into a line.
  // WebGL1 without derivatives keeps the measured distance-only fallback.
  float camDist = distance(cameraPosition, vRenderPosition);
  float detailFade = 1.0 / (1.0 + camDist * 0.006);
  float metresPerPixel = camDist * 0.0028;
#if __VERSION__ >= 300 || defined(GL_OES_standard_derivatives)
  metresPerPixel = max(length(dFdx(vAbsoluteXZ)), length(dFdy(vAbsoluteXZ)));
#endif
  float structurePixelLod = 1.0 - smoothstep(5.0, 18.0, metresPerPixel);
  float skinPixelLod = 1.0 - smoothstep(0.8, 4.5, metresPerPixel);
  float structureLod = smoothstep(0.09, 0.26, detailFade) * structurePixelLod;
  float detailLod = smoothstep(0.16, 0.34, detailFade) * skinPixelLod;
  float foamLod = smoothstep(0.10, 0.26, detailFade) * structurePixelLod;
  bool nearWater = structureLod > 0.015;
  bool skinWater = detailLod > 0.015;
  // The bed's BROAD structure — bars and cobble beds, tens of metres — is
  // what the chart sees from four hundred metres up and what an aerial
  // photograph of any clear river is made of; only the pebbles and stones
  // alias at that range. It has its own projected gate and is NOT nested
  // under nearWater: that old nesting cut a still-full bedLod to zero at
  // about 875m.
  float bedPixelLod = 1.0 - smoothstep(10.0, 34.0, metresPerPixel);
  float bedLod = smoothstep(0.035, 0.16, detailFade) * bedPixelLod;
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
  // Connected profile evidence carries lip, sheet and landing through the
  // same chart. A bank slope or energetic bend cannot earn a falling sheet.
  vec4 fallField = vec4(0.0);
#ifdef HYDRO_FALLS
  fallField = texture2D(uHydroFalls, vHydroUv);
#endif
  float waterfall = fallField.r;
  vec3 normal = macroNormal;
  if (nearWater) {
    vec2 gradient = vec2(0.0);
    if (skinWater) {
#ifdef HYDRO_FLOWING
      gradient = vFlowing > 0.5
        ? rippleGradientRiver(riverS, riverCross, flow, energy, seed)
        : rippleGradient(vAbsoluteXZ, flow, wind, energy, seed);
#else
      gradient = rippleGradient(vAbsoluteXZ, flow, wind, energy, seed);
#endif
    }

#ifdef HYDRO_FLOWING
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
      // These are BED-ANCHORED standing facets. Their strength breathes, but
      // their crests do not run downstream with transported foam.
      float slowFacet = cos(riverS * 0.22 + seed * 4.1);
      float fastFacet = cos(riverS * 0.40 + seed * 4.1);
      float facetPulse = 0.92 + sin(uTime * 1.1 + seed * 6.283) * 0.08;
      float facet = mix(slowFacet, fastFacet, smoothstep(0.3, 0.8, energy))
        * facetPulse;
      float acrossPhase = riverCross * 0.35
        + sin(riverS * 0.103) * 1.3;
      gradient += flowDirection * facet * work * structureLod
        * (0.022 + energy * 0.060);
      gradient += acrossDirection * cos(acrossPhase) * work * structureLod
        * (0.014 + energy * 0.032);

      // On bends, a slower circulating normal lives beside the downstream
      // riffles. It is strongest on the slack inside lane, while outer-bank
      // turbulence remains the faster, breaking response above.
      vec3 eddy = riverEddyField(
        riverS, riverCross, max(riverField.a, 1.0), riverField.b, energy, seed
      );
      gradient += (flowDirection * eddy.x + acrossDirection * eddy.y)
        * 0.24 * structureLod;
      riverEddyTone = eddy.z;
    }
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
      vec2 dropJitter = vec2(
        hash21(dropCell + vec2(13.7, 4.2)),
        hash21(dropCell + vec2(2.9, 19.1))
      ) - 0.5;
      vec2 dropP = fract(vAbsoluteXZ / 3.0) - 0.5 - dropJitter * 0.52;
      float cadence = mix(0.52, 0.92, hash21(dropCell + 31.7));
      float age = fract(uTime * cadence + hash21(dropCell));
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
    // Perturb the actual face, not a slope clamped to a near-horizontal
    // surface. Keep the sheet's normal on steep drops.
    normal = normalize(macroNormal - vec3(gradient.x, 0.0, gradient.y)
      * max(0.025, macroNormal.y));
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
  if (coastalKind) {
    float beachProfile = 1.0 - step(0.5, abs(vCoastProfile - 0.0));
    float shingleProfile = 1.0 - step(0.5, abs(vCoastProfile - 1.0));
    float platformProfile = 1.0 - step(0.5, abs(vCoastProfile - 2.0));
    float cliffProfile = 1.0 - step(0.5, abs(vCoastProfile - 3.0));
    float inletProfile = 1.0 - step(0.5, abs(vCoastProfile - 4.0));
    if (uLookModel > 0.5) {
      beachProfile = vCoastWeights.x; shingleProfile = vCoastWeights.y;
      platformProfile = vCoastWeights.z; cliffProfile = vCoastWeights.w;
      inletProfile = max(0.0, 1.0 - dot(vCoastWeights, vec4(1.0)));
    }
    shoalWidth *= beachProfile
      + shingleProfile * 0.66
      + platformProfile * 0.82
      + cliffProfile * 0.34
      + inletProfile * 0.72;
    swashWidth *= beachProfile
      + shingleProfile * 0.52
      + platformProfile * 0.76
      + cliffProfile * 0.28
      + inletProfile * 0.58;
  }
  float phaseAdvance = smoothstep(-0.24, 0.88, vShorePhase);
  float shoreCoordinate = geometryField.g
    + mix(-0.25, 0.65, phaseAdvance) * swashWidth;
  float distanceWet = smoothstep(-swashWidth, shoalWidth, shoreCoordinate);
  float depthTarget = coastalKind ? mix(2.2, 4.5, fetchShape)
    : (wetlandKind ? 0.8 : (inlandStandingKind ? 2.0 : 0.7));
  float depthWet = smoothstep(0.08, depthTarget, geometryField.a);
  float shoreWetness = clamp(distanceWet * mix(0.62, 1.0, depthWet), 0.0, 1.0);
  // LOOK: inland standing water starts AT the ground, like a river does. The
  // coast keeps its swash, which owns its own wet strip on the surf mesh.
  if (uLookModel > 0.5 && !coastalKind) shoreWetness *= coverageInterior;
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5 && flowingKind) {
    // Bank width follows metres and depth, not 30% of every channel.
    float bankMetres = max(0.0, (1.0 - abs(riverField.g)) * riverField.a);
    bankMetres = mix(bankMetres, max(0.0, geometryField.g), beyondRibbon);
    // Coverage distance owns the rendered contour. River-space N owns the
    // channel section, but bends and rasterised area banks can place N=±1 a
    // few metres away from the actual coverage cut. Shading from N alone let
    // bright water run all the way to a differently shaped terrain edge.
    // Taking the nearer of both coordinates guarantees zero wetness on the
    // exact contour while retaining the smooth vector-space shelf inward.
    float shoreMetres = max(0.0, min(bankMetres, geometryField.g));
    float bankSlope = geometryField.a / max(0.35, shoreMetres);
    // A sub-half-metre fade vanished into one display pixel from the
    // production camera and left a hard cut-out. Keep a real shallow shelf
    // on even a steep bank, widening naturally where the channel is gentle.
    // This is a continuous material transition inside the resolved body, not
    // alpha stipple or local post-processing.
    float riverFadeM = clamp(1.65 / max(0.08, bankSlope), 2.4, 8.0);
    float channelWet = smoothstep(0.0, riverFadeM, shoreMetres);
    shoreWetness = clamp(channelWet * mix(0.08, 1.0, depthWet)
      * coverageInterior, 0.0, 1.0);
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
  // LOOK: a mapped lake with no bathymetry carries a nominal few centimetres
  // everywhere (0.08 m across Lake Bled), which put the whole bed on show and
  // every class step with it. Offshore, the bed sits at the same depth the
  // colour already assumes.
  if (uLookModel > 0.5) bedDepth = mix(bedDepth, max(bedDepth, visualDepth), offshore);
  float pointBar = 0.0;
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5) {
    float across = clamp(abs(riverField.g), 0.0, 1.0);
    // Most natural channels carry a narrower thalweg between broad shallow
    // shoulders. The old semicircle retained two thirds of full depth at
    // eighty percent of the half-width, so the bed appeared only as a hairline
    // at the bank. This continuous section exposes bars and pebbles across a
    // useful margin without changing the physics depth stored in the field.
    float trough = mix(0.08, 1.0, pow(max(0.0, 1.0 - across), 0.62));
    trough = mix(trough, 1.0, beyondRibbon * smoothstep(2.0, 10.0, geometryField.g));
    // A bend deposits a coherent shelf on its INSIDE bank. Curvature and side
    // choose the place; broad cross-channel position shapes it. This is a
    // geomorphic signal, not extra texture noise, so bars turn with the river
    // and remain stable through the global post pipeline.
    pointBar = smoothstep(0.0015, 0.009, abs(riverField.b))
      * (1.0 - outerBank) * smoothstep(0.30, 0.94, across);
    // The large shelf is now cut into terrain from this same curvature
    // evidence. Point-bar strength remains here only to select and clarify
    // the fine sediment/mineral skin over that supporting geometry.
    visualDepth *= trough;
    bedDepth *= trough;
  }
#endif
  // Camera angle changes reflection and how much of the bed pattern is
  // legible, but it does not change the material's physical water depth.
  // The old 1.0→1.9 multiplier made one river change optical character
  // between the cab and chart.
  float overhead = clamp(normalize(cameraPosition - vRenderPosition).y, 0.0, 1.0);
  vec3 colour = palette(kind, visualDepth, turbidity, terrainC);
  if (uLookModel > 0.5 && any(notEqual(lookKinds, vec4(kind)))) {
    // LOOK: where two kinds meet (sea and lagoon, lake and river mouth) the
    // palette steps at every nearest-sampled texel of the class field. Blend
    // the neighbours' palettes with the same weights the field would have.
    colour = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      float ki = i == 0 ? lookKinds.x : i == 1 ? lookKinds.y : i == 2 ? lookKinds.z : lookKinds.w;
      float wi = i == 0 ? lookWeights.x : i == 1 ? lookWeights.y : i == 2 ? lookWeights.z : lookWeights.w;
      if (wi > 0.0) colour += palette(ki, visualDepth, turbidity, terrainC) * wi;
    }
  }

  // ── THE SHALLOW WATER HAS A FLOOR ──
  //
  // An opaque surface that only tints toward terrain still reads as a ribbon
  // laid over the valley. Clear, shallow water instead returns a stable bed:
  // broad sediment, finer pebble variation and darker cobble aggregates.
  // Flowing water evaluates the pattern in (s,n), so gravel bars turn with the
  // river; standing water uses world space. Turbidity, depth, rapid aeration
  // and distance all remove the detail continuously.
  if (bedLod > 0.015) {
    float clearDepthM = mix(3.8, 0.86, suspendedScattering);
    float bedVisibility = (1.0 - smoothstep(0.10, clearDepthM, bedDepth))
      * (1.0 - suspendedScattering * 0.64) * bedLod
      * mix(0.62, 1.0, vFlowing) * (1.0 - shallowRapid * 0.48)
      * clamp(uShallowBedStrength, 0.0, 3.0);
    bedVisibility *= 1.0 + pointBar * 0.65;
    // Deep water and opaque silt skip every bed-noise evaluation.
    if (bedVisibility > 0.015) {
      vec2 bedP = vAbsoluteXZ;
      vec2 bedFlowP = bedP;
      float grainScale = 1.0;
#ifdef HYDRO_FLOWING
      if (vFlowing > 0.5) {
        // The field-resolution river chart is the right coordinate for broad
        // bars that turn with the channel. It is far too coarse to parameterise
        // metre-scale pebbles: doing so exposed every 18.75m production texel.
        bedFlowP = vec2(riverS, riverCross);
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
      float gravelBar = smoothstep(0.28, 0.72,
        valueNoise(bedFlowP * vec2(0.012, 0.026) / grainScale
          + vec2(seed * 3.0, -4.6)));
      float sandBed = 1.0 - clamp(abs(bedClass - 2.0), 0.0, 1.0);
      float coarseBed = smoothstep(2.2, 4.2, bedClass);
      float stonePresence = smoothstep(2.6, 4.1, bedClass);
      float rockBed = smoothstep(4.2, 5.0, bedClass);
      // Silt stays broad and quiet; sand introduces bars; gravel, pebbles and
      // rock retain the full patch structure supplied by the substrate.
      float bedPatch = mix(
        0.5 + (gravelBar - 0.5) * 0.18,
        gravelBar,
        smoothstep(1.5, 3.2, bedClass)
      );
      bedPatch = max(bedPatch, pointBar * mix(0.62, 0.92, gravelBar));
      float cobble = smoothstep(0.54, 0.79,
        valueNoise(bedP * vec2(0.22, 0.31) / grainScale
          + vec2(seed * 5.0, -8.0)));
      // Submerged pebbles are a continuous clustered mineral texture. One
      // synthetic object per procedural cell survived the camera as a grid of
      // dark tiles; actual protruding rocks remain production geometry and
      // colliders instead. This is albedo structure, never local dithering.
      float stoneCluster = smoothstep(0.48, 0.74,
        valueNoise(bedP * vec2(0.29, 0.41) / grainScale
          + vec2(seed * 17.0, 3.1)) * 0.62
        + valueNoise(bedP * vec2(0.57, 0.73) / grainScale
          - vec2(4.2, seed * 13.0)) * 0.38);
      float stoneGrain = valueNoise(bedP * vec2(1.12, 1.46) / grainScale
        + vec2(seed * 29.0, -7.3));
      // The bed is the bank's own material: wet ground, and a bar's dry
      // top at most a touch lighter than the ground beside it. The sand
      // constants that stood here painted a beach into a grassland.
      vec3 siltSediment = wetGround(terrainC) * mix(0.92, 1.0, suspendedScattering);
      vec3 coarseSediment = mix(terrainC * 0.96, wetGround(terrainC) * 1.04,
        0.34 + suspendedScattering * 0.30);
      vec3 sandSediment = mix(terrainC * 1.08, wetGround(terrainC) * 1.02, 0.36);
      vec3 sediment = mix(siltSediment, coarseSediment, coarseBed);
      sediment = mix(sediment, sandSediment, sandBed);
      // Gravel is a change in mineral structure, not a cream outline around
      // every channel. The old path could raise local ground by 32% here and
      // another 30% below, then replace 95% of the water with it: from above,
      // the entire shallow shelf became one pale ribbon. Keep the bed in the
      // bank's own key, with only enough lift for bars to survive global post.
      vec3 gravelMineral = mix(
        sediment,
        mix(terrainC, wetGround(terrainC), 0.18) * 1.08,
        0.34 + coarseBed * 0.22
      );
      // From above the bars and pools are the read, so their contrast opens
      // with the view's overhead component; the fine grain fades with range.
      vec3 bedColour = mix(
        sediment * mix(0.86, 0.76, overhead),
        gravelMineral * mix(1.02, 1.12, overhead),
        bedPatch
      ) * (0.96 + ((pebble - 0.5) * mix(0.10, 0.34, coarseBed)
        + (bar - 0.5) * mix(0.14, 0.26, coarseBed)
        + (stoneGrain - 0.5) * 0.18 * stonePresence) * detailLod);
      // Cobble is a darker aggregate in the sediment, not an object silhouette.
      // Protruding rocks are real production geometry and carry the stronger read.
      vec3 cobbleColour = mix(sediment * 0.62, terrainC * 0.76, 0.38);
      bedColour = mix(bedColour, cobbleColour,
        cobble * mix(0.30, 0.14, suspendedScattering) * coarseBed
          * (1.0 + 0.7 * overhead));
      bedColour = mix(bedColour, cobbleColour * mix(0.74, 0.60, rockBed),
        stoneCluster * stonePresence * mix(0.46, 0.22, suspendedScattering)
          * mix(0.58, 1.0, detailLod));
      // Pebbles need a close-range read distinct from the broad gravel bars.
      // This is a smooth mineral mask in world space, not a screen-space
      // stipple: it remains stationary and the global pipeline alone decides
      // how the final image is quantised.
      float pebbleSpeck = smoothstep(0.62, 0.82, stoneGrain)
        * stonePresence * detailLod;
      bedColour = mix(bedColour, cobbleColour * 0.82,
        pebbleSpeck * mix(0.30, 0.16, suspendedScattering));
      // THE BED IS SEEN THROUGH THE WATER, NOT BESIDE IT. The bed's colour
      // was mixed in as painted — dry sand at any depth it was visible at —
      // so a river a metre and a half deep read from above as a cream
      // sandbar, which is what the seat saw at the Senqu. Light to the bed
      // and back crosses the column twice, and water eats red long before
      // green and blue: at 1.3 m the bed keeps half its red and three
      // quarters of its blue and goes the dark olive a real riverbed is.
      // Silt shortens the path further.
      float opticalBedDepth = max(0.0, bedDepth - 0.08);
      bedColour *= exp(-vec3(0.42, 0.21, 0.14) * opticalBedDepth
        * (1.0 + suspendedScattering * 2.0));
      // Retain a real water column over flowing shallows. Without this cap the
      // bed replaced virtually the whole surface at the bank, so removing the
      // bed term made the river disappear and enabling it drew a hard mineral
      // stripe. Standing-water behaviour is unchanged.
      float bedMixCap = mix(0.95, 0.82, vFlowing);
      colour = mix(colour, bedColour,
        clamp(bedVisibility * mix(1.0, 0.64, suspendedScattering), 0.0, bedMixCap));
    }
  }

  // The edge is damp terrain becoming shallow water, never a separately dark
  // contact stripe. Depth and distance both contribute, so the transition
  // remains broad at an ocean and compact at a river or pond.
  // At coverage zero the body must reproduce the terrain underneath exactly.
  // Darkening from a wet film begins only after entering the channel; doing it
  // at the contour drew a serrated trench even when terrain and water shared
  // the same topology.
  float dampFilm = smoothstep(0.08, 0.58, shoreWetness);
  vec3 edgeGround = mix(terrainC, wetGround(terrainC),
    dampFilm * mix(0.52, 0.74, suspendedScattering));
  vec3 dampTerrain = mix(
    edgeGround,
    colour,
    (wetlandKind ? 0.30 : 0.10) * dampFilm
  );
#ifdef HYDRO_FLOWING
  if (vFlowing > 0.5 && flowingKind) {
    // The waterline is the same local material as the ground, darkened by a
    // film of water. Holding this over the metre-scale fade prevents the
    // opaque river body from meeting terrain as two unrelated palette blocks.
    dampTerrain = mix(edgeGround, colour, 0.10 * dampFilm);
    // The last wet metre contains gravel bars, damp sediment and broken
    // reflected water rather than one dark contact stripe. This lies inside
    // the opaque surface and meets the physical coverage waterline at the bank.
    float bankNear = smoothstep(0.58, 1.06, abs(riverField.g))
      * (1.0 - beyondRibbon * smoothstep(3.0, 12.0, geometryField.g));
    float bankGrain = valueNoise(vec2(
      riverS * 0.19 + seed * 13.0,
      riverCross * 2.7 - riverS * 0.027
    ));
    float bankBar = valueNoise(vec2(
      riverS * 0.052 - seed * 5.0,
      riverCross * 0.82 + riverS * 0.009
    ));
    float bankPatch = smoothstep(0.22, 0.78, bankGrain * 0.42 + bankBar * 0.58)
      * bankNear * smoothstep(0.12, 0.48, shoreWetness)
      * detailLod * clamp(uRiverEdgeStrength, 0.0, 3.0);
    vec3 soilEdge = mix(
      terrainC * 0.72,
      wetGround(terrainC) * 1.1,
      0.28 + (1.0 - turbidity) * 0.18
    );
    float mudBank = 1.0 - clamp(abs(bankClass - 1.0), 0.0, 1.0);
    float gravelBank = 1.0 - clamp(abs(bankClass - 2.0), 0.0, 1.0);
    float rockBank = 1.0 - clamp(abs(bankClass - 3.0), 0.0, 1.0);
    vec3 edgeMaterial = soilEdge;
    edgeMaterial = mix(edgeMaterial, wetGround(terrainC) * 0.74, mudBank);
    edgeMaterial = mix(edgeMaterial,
      mix(terrainC * 0.88, wetGround(terrainC) * 1.16, bankGrain * 0.48),
      gravelBank);
    edgeMaterial = mix(edgeMaterial,
      mix(terrainC * 0.58, wetGround(terrainC) * 0.82, bankBar * 0.32),
      rockBank);
    colour = mix(colour, mix(dampTerrain, edgeMaterial, 0.52),
      clamp(bankPatch * 0.55, 0.0, 0.74));
  }
#endif
  float waterBlend = smoothstep(0.07, 0.92, shoreWetness);
#ifdef HYDRO_EDGE_BLEND
  waterBlend = mix(1.0, waterBlend, step(0.5, uEdgeBlendEnabled));
#endif
  colour = mix(dampTerrain, colour, waterBlend);
  // ── LOOK: WATER-ONLY TERMS STAY ON THE WATER ──
  // Everything below (tone, grain, lanes, the broad field, the sky's mirror,
  // the glint) used to act on the whole fragment AFTER the handoff above, so
  // the fringe that exists to BE the ground still carried up to 46% sky and a
  // ±14% tonal field — a bright or dark rim drawn exactly on the coverage
  // contour, which is the field raster made visible. Under the look model
  // those terms scale with how much water there is.
  // Keyed to the COVERAGE handoff (the literal cut), not to the wetness
  // shading: across a wide estuary the river-space wetness can sit near zero
  // over the whole body, and gating on it stripped the water of everything
  // that made it read as water.
  float presence = uLookModel > 0.5 ? coverageInterior : 1.0;

  // Geometry supplies the cheapest and most important structure signal.
  // Give its crest/trough enough tonal separation to cross a palette rung,
  // while broad random variation recedes into a supporting role.
  float bodyTone = vSurfaceWave * mix(0.035, 0.13, vSurfaceEnergy)
    * mix(1.0, 1.18, vFlowing);
  float shoalCrest = (1.0 - vFlowing) * vShoal
    * smoothstep(0.34, 0.94, vSurfaceWave) * 0.075;
  colour *= 1.0 + (bodyTone + shoalCrest) * presence;

  float grain = 0.5;
  if (skinWater) {
#ifdef HYDRO_FLOWING
    // The river's grain advects in river space at a CONSTANT rate. It used
    // to slide world noise along the per-texel flow vector, which is
    // differential advection: neighbouring fragments on a bend sample
    // ever-more-distant noise as time passes, and the texture shears into
    // shimmer. The shared transport coordinate cannot shear and now agrees
    // with streaks and foam about how material moves.
    grain = vFlowing > 0.5
      ? valueNoise(vec2(riverTransport * 0.12, riverCross * 0.4 + seed * 7.0))
      : valueNoise(vAbsoluteXZ * mix(0.28, 0.055, energy)
        + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
#else
    grain = valueNoise(vAbsoluteXZ * mix(0.28, 0.055, energy)
      + flow * uTime * mix(0.12, 0.55, clamp(length(flow), 0.0, 1.0)));
#endif
    colour *= 1.0 + (grain - 0.5) * 0.14 * detailLod * presence;
  }
  if (nearWater) {
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
    if (vFlowing > 0.5) {
      along = riverTransport;
      acrossStreak = riverCross * 0.7;
      streakRate = 0.0;
    }
#endif
    float streak = valueNoise(vec2(along * 0.045 - uTime * streakRate,
      acrossStreak * 0.5 + seed * 9.0));
    float streakAmp = mix(smoothstep(3.0, 10.0, uWind.z) * 0.05,
      (0.05 + energy * 0.06), vFlowing);
    colour *= 1.0 + (streak - 0.5) * streakAmp * structureLod * presence;
#ifdef HYDRO_FLOWING
    // A small tonal counterpart lets an eddy read under diffuse light, when
    // its normal alone would disappear. It remains water-coloured and never
    // crosses into white foam.
    colour *= 1.0 + riverEddyTone * 0.16 * structureLod * presence;
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
  colour *= 1.0 + (broad - 0.5) * 0.28 * mix(1.0, 0.55, vFlowing) * presence;

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
  // LOOK: the sky colours already carry the hour (applySkyTint mixes toward
  // NIGHT_SKY by dayF). Dimming them again made the one thing that
  // distinguishes water at dusk and night — a mirror of a horizon brighter
  // than moonlit ground — darker than the ground.
  float skyEnergy = uLookModel > 0.5 ? 1.0 : mix(0.40, 1.0, daylight);
  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  // LOOKING DOWN, THE WATER REFLECTS THE ZENITH. The horizon colour served
  // every view angle, and from the chart that put the bright horizon band
  // in a surface whose mirror points straight up at the darkest sky there is.
  vec3 reflectedSky = mix(uZenith, horizonColour, pow(1.0 - facing, 0.5));
  float unresolvedRoughness = (1.0 - skinPixelLod)
    * mix(vSurfaceEnergy, energy, vFlowing);
  float surfaceRoughness = clamp(
    (0.04 + mix(vSurfaceEnergy, energy, vFlowing) * 0.52
      + vTurbulence * 0.22) * uSurfaceRoughness
      + unresolvedRoughness * 0.55
      + uRain * (1.0 - skinPixelLod) * 0.34,
    0.0, 1.0);
#ifdef HYDRO_SCENE_REFLECTION
  vec3 reflectedDirection = reflect(-viewDirection, normal);
  reflectedSky = sceneReflectedSky(
    vRenderPosition, reflectedDirection, uZenith, horizonColour,
    lightDirection, surfaceRoughness
  );
#else
  // A host without a reflected environment keeps the former horizon/zenith
  // answer and borrows a restrained amount of its cloud-shadow value.
  reflectedSky *= mix(1.0, shade, 0.65);
#endif
  reflectedSky *= skyEnergy;
  // Dielectric water starts near two percent head-on. The artistic ceiling
  // remains the established 46%, but it is earned toward grazing angles.
  float waterF0 = 0.02;
  float fresnel = waterF0 + (0.46 - waterF0) * pow(1.0 - facing, 3.0);
  // A turbulent river reflects the same sky over many unresolved microfacets,
  // which broadens and dims the return. Using the sea's mirror strength on the
  // analytic rapid facets made each one a pale card over the valley.
  fresnel *= mix(1.0, 0.78, surfaceRoughness)
    * mix(1.0, 0.58, vFlowing);
  if (uLookModel > 0.5) {
    // LOOK: Schlick's full curve. Water is a 2% mirror head-on and nearly a
    // whole one at grazing, which is why a distant reach takes the sky's
    // colour — orange at sunset, pale under haze, the horizon's blue at
    // night — instead of the same teal at every hour. Roughness still
    // spreads it (an unresolved chop averages steeper facets) and a river's
    // broken surface still returns less; the ceiling stays below a mirror so
    // the palette keeps a body under every reflection.
    float grazing = 1.0 - facing;
    fresnel = waterF0 + (1.0 - waterF0) * grazing * grazing * grazing * grazing * grazing;
    fresnel *= mix(1.0, 0.72, surfaceRoughness) * mix(1.0, 0.82, vFlowing);
    fresnel = min(fresnel, 0.86) * presence;
  }
  colour = mix(colour, reflectedSky, fresnel);

  // In shallow/turbid water the bed and banks tint the returning light. This
  // is continuous environmental coupling, not a second time-of-day colour.
  float terrainCoupling = (1.0 - smoothstep(0.45, 4.5, bedDepth))
    * mix(0.08, 0.28, suspendedScattering);
  colour = mix(colour,
    terrainC * sceneLight * 0.9,
    terrainCoupling);

  if (nearWater) {
    // The glint is broad and quiet. A narrow bright crest highlight is what
    // the quantiser promotes into white wave diagrams at low sun. Sparkle
    // comes from MODULATING that quiet lobe by the advected grain.
    float glintPower = mix(14.0, 4.0, surfaceRoughness);
    float glint = pow(max(0.0, dot(reflect(-lightDirection, normal), viewDirection)), glintPower);
    float sparkle = 0.55 + 0.9 * smoothstep(0.45, 0.85, grain);
    colour += vec3(1.0, 0.9, 0.7) * glint * sparkle
      * mix(0.11, 0.04, surfaceRoughness)
      * daylight * shade * detailLod * mix(1.0, 0.46, vFlowing) * presence;
    if (uLookModel > 0.5 && uMoonColour.r + uMoonColour.g + uMoonColour.b > 0.001) {
      // THE MOON'S PATH. The one night cue water owns: a broken column of
      // light under the moon, made of the same advected grain as the sun's
      // sparkle so it moves with the current and the wind.
      vec3 moonDirection = normalize(uMoonDirection);
      float moonPower = mix(90.0, 10.0, surfaceRoughness);
      float moonGlint = pow(max(0.0, dot(reflect(-moonDirection, normal), viewDirection)), moonPower);
      float moonSparkle = 0.35 + 1.3 * smoothstep(0.5, 0.9, grain);
      colour += uMoonColour * moonGlint * moonSparkle * mix(0.55, 0.22, surfaceRoughness)
        * step(0.0, moonDirection.y) * (1.0 - daylight) * shade
        * mix(1.0, 0.6, vFlowing) * presence;
    }
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
    || (vWaveCrest > 0.6 && (uLookModel > 0.5 ? max(geometryField.a, visualDepth) : geometryField.a) < 6.0);
  if (nearWater && foamZone) {
    // ── FOAM: SPARSE, CAUSAL, BRIEF ──
    // Standing water keeps the fixed world axes it always fragmented on
    // (flow there is ~zero, so the old normalize degenerated to +x anyway);
    // a river's foam runs in (s, n) so a streak of it rides its own bend.
    float downstream = vAbsoluteXZ.x;
    float transportedDownstream = downstream;
    float across = vAbsoluteXZ.y;
    float foamRate = 0.72 + energy * 1.1;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) {
      downstream = riverS;
      transportedDownstream = riverTransport;
      across = riverCross;
      // transportedDownstream already contains the one body-constant
      // advection clock shared by grain and current lanes.
      foamRate = 0.0;
    }
#endif
    // ── SOURCES BEFORE TEXTURE ──
    //
    // Reach energy already carries a distance-based downstream memory from
    // build-tile. Recover the HEAD of that memory from local field evidence:
    // an energy rise, a shallowing crest or a narrowing channel. Noise may
    // fragment and age the transported material after that; it no longer gets
    // to invent the place a rapid starts.
    float causalEnergy = energy;
    float foamSource = 0.0;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) {
      vec2 flowDirection = normalize(flow + vec2(0.00001, 0.0));
      vec2 flowGrid = normalize(vec2(
        flowDirection.x / max(uFieldMeters.x, 0.001),
        flowDirection.y / max(uFieldMeters.y, 0.001)
      ));
      vec2 flowTexel = flowGrid * uHydroTexel * 1.35;
      vec4 upstreamGeometry = texture2D(uHydroGeometry, vHydroUv - flowTexel);
      vec4 upstreamDynamics = texture2D(uHydroDynamics, vHydroUv - flowTexel);
      vec4 upstreamStructure = texture2D(uHydroStructure, vHydroUv - flowTexel);
      float energyRise = max(0.0, causalEnergy - upstreamDynamics.w);
      float crestRise = max(0.0, upstreamGeometry.a - geometryField.a);
      float constriction = max(0.0,
        upstreamStructure.a - riverField.a) / max(upstreamStructure.a, 1.0);
      foamSource = max(
        smoothstep(0.035, 0.18, energyRise),
        max(
          smoothstep(0.12, 0.72, crestRise),
          smoothstep(0.035, 0.22, constriction)
        ) * smoothstep(0.28, 0.72, causalEnergy)
      );
      // A waterfall toe is explicit source evidence, not inferred texture.
      foamSource = max(foamSource, fallField.b);
    }
#endif
    float energyGate = max(smoothstep(0.57, 0.84, causalEnergy),
      shallowRapid * 0.56);
    float sourceHead = smoothstep(0.08, 0.52, foamSource);
    float downstreamMemory = smoothstep(0.44, 0.78, causalEnergy)
      * (1.0 - sourceHead * 0.4);
    // Noise groups the downstream MEMORY into recognisable tails, but an
    // evidenced source always survives it and begins the connected tongue.
    float memoryBreakup = smoothstep(0.50, 0.76,
      valueNoise(vec2(downstream * 0.032 + seed * 19.0, seed * 7.0 + 3.0)));
    float rapidReach = max(sourceHead, downstreamMemory * memoryBreakup);
    float foamAge = clamp(
      (causalEnergy - foamSource * 0.72) / max(causalEnergy, 0.001),
      0.0, 1.0);
    // Whitewater gathers into broad downstream tongues. Cross-stream noise
    // used to be almost metre-scale and presented as evenly scattered white
    // flecks; this slow lane field gives each rapid a coherent head and tail.
    float rapidTongue = 1.0;
#ifdef HYDRO_FLOWING
    if (vFlowing > 0.5) {
      float laneCentre = (valueNoise(vec2(
        downstream * 0.018 + seed * 7.0, seed * 23.0 + 5.0
      )) - 0.5) * 0.82;
      float primaryTongue = 1.0 - smoothstep(0.18, 0.54,
        abs(riverField.g - laneCentre));
      float splitTongue = (1.0 - smoothstep(0.12, 0.34,
        abs(riverField.g + laneCentre * 0.46)))
        * smoothstep(0.54, 0.84, causalEnergy);
      rapidTongue = max(primaryTongue, splitTongue * 0.55);
    }
#endif
    float foamStreak = valueNoise(vec2(
      transportedDownstream * 0.085 - uTime * foamRate,
      across * 0.20 + seed * 13.0));
    float foamBreak = smoothstep(0.64, 0.84,
      valueNoise(vec2(transportedDownstream * 0.34,
        across * 0.32 - seed * 9.0 + uTime * 0.07)));
    float brokenFoam = vFlowing * energyGate
      * smoothstep(0.72, 0.92, foamStreak + grain * 0.08)
      * foamBreak * rapidReach * rapidTongue
      * mix(0.08, 0.16, foamAge)
      * clamp(uTurbulenceStrength, 0.0, 3.0);
    // A low-opacity connected body underneath the broken crest fragments
    // makes the rapid read as one tongue of aerated water rather than a bag
    // of white confetti. It retains water colour and follows the same lane.
    float tongueEnergy = max(energyGate, shallowRapid * 0.90);
    // The stationary reach mask may suppress broken crests completely, but a
    // physically shallow high-energy reach must still read as working water.
    // Keep a restrained aeration floor for the connected tongue only.
    float tongueReach = mix(0.38, 1.0, rapidReach);
    float tongueBody = vFlowing * tongueEnergy * tongueReach * rapidTongue
      * (0.10 + foamStreak * 0.075) * mix(1.24, 0.72, foamAge)
      * clamp(uTurbulenceStrength, 0.0, 3.0);
    float riverFoam = max(brokenFoam, tongueBody);
    // A second, shorter chop breaks shallow high-energy reaches into flecks.
    // Deep energetic water keeps boil and long streaks; it does not become a
    // uniformly white rapid merely because its profile is steep.
    float rapidChop = shallowRapid * smoothstep(0.64, 0.86,
      valueNoise(vec2(downstream * 0.45 - uTime * 1.72,
        across * 0.82 + seed * 5.0)));
    riverFoam = max(riverFoam,
      rapidChop * foamBreak * rapidReach * rapidTongue * 0.035);
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
    colour *= 1.0 + workingWater * boil * 0.30 * structureLod;
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
      * max(crestPick, spentWash * 0.42) * fragmentNoise * mix(0.2, 1.0, vExposure);
    // ── SPILLING CRESTS, JUST SEAWARD OF THE BREAK ──
    // Shoaling steepens a crest before the depth band catches it; its top
    // whitens faintly as it comes in. Gated by the same fragment noise as
    // the breakers so the pre-surf stays broken patches, and by depth so
    // open-water crests never wear it.
    float spill = (1.0 - vFlowing) * smoothstep(0.78, 0.98, vWaveCrest)
      * (1.0 - smoothstep(2.2, 6.0, uLookModel > 0.5 ? max(geometryField.a, visualDepth) : geometryField.a))
      * fragmentNoise * 0.35
      * mix(0.2, 1.0, vExposure);
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
      foamColour = mix(colour * 1.18, foamColour, 0.42);
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
    // Soft beds answer after the hull has passed. The trail's W channel is a
    // delayed, finite-lived signal, so this blooms behind the vehicle instead
    // of painting the live body and remains absent over gravel or rock.
    float softBed = 1.0 - smoothstep(2.2, 3.4, bedClass);
    float sedimentPlume = rigTrailResponse.w * softBed
      * mix(0.28, 0.62, suspendedScattering);
    vec3 plumeColour = wetGround(terrainC) * sceneLight * 0.82;
    colour = mix(colour, plumeColour, clamp(sedimentPlume, 0.0, 0.46));
    float wake = clamp(liveFoam, 0.0, 0.76) * foamLod;
    vec3 wakeFoam = vec3(0.84, 0.9, 0.88) * sceneLight;
    colour = mix(colour, wakeFoam, wake);
  }

#ifdef HYDRO_FALLS
  if (waterfall + fallField.b > 0.001) {
    float progress = fallField.g;
    // Free-fall travel time is a spatial coordinate. Subtract global time:
    // features accelerate down the sheet without multiplying time by a
    // varying local velocity (which tears phases between adjacent faces).
    float fallenM = progress * max(4.0, fallField.a);
    float travel = sqrt((fallenM + 2.0) * (2.0 / 9.81));
    float strandPhase = travel - uTime * 0.85;
    float crossM = riverCross * mix(1.0, 1.17, sin(progress * 3.14159));
    float longStrands = valueNoise(vec2(crossM * 1.15, strandPhase * 1.6));
    float fineStrands = valueNoise(vec2(crossM * 2.6 + 7.0, strandPhase * 3.5));
    float threads = smoothstep(0.42, 0.78, longStrands * 0.78 + fineStrands * 0.22);
    float aeration = (0.10 + smoothstep(0.08, 0.8, progress) * 0.18)
      + threads * (0.32 + progress * 0.22) * detailLod;
    // Suppress inherited rapid blotches on the face; retain a dark water
    // foundation between bright strands rather than a white opaque ribbon.
    vec3 sheetBase = mix(uTerrainColour * uGroundGain, vec3(0.18, 0.29, 0.30), 0.65) * sceneLight;
    vec3 sheetColour = mix(sheetBase, vec3(0.82, 0.89, 0.87) * sceneLight,
      clamp(aeration * uFoamStrength, 0.0, 0.88));
    colour = mix(colour, sheetColour, waterfall);

    // Impact is strongest at the connected toe, then spreads across the
    // channel and loses strength downstream. No billboard/particle pass.
    float tailNoise = valueNoise(vec2(riverS * 0.16 - uTime * 1.8, riverCross * 0.35));
    float landingWidth = 1.0 - smoothstep(0.55, 1.2, abs(riverField.g));
    float impactFoam = fallField.b * landingWidth
      * (0.38 + smoothstep(0.28, 0.76, tailNoise) * 0.5 * foamLod)
      * clamp(uFoamStrength, 0.0, 3.0);
    colour = mix(colour, vec3(0.78, 0.86, 0.83) * sceneLight, clamp(impactFoam, 0.0, 0.85));
  }
#endif
  // The retained surf strip is exposed ground, not transparent water. It
  // keeps a restrained sky sheen while the phase-history signal dries.
#ifdef HYDRO_SURF
  if (recentlyWashed > 0.001) {
    vec3 wetTerrain = wetGround(terrainC) * sceneLight * 0.78;
    wetTerrain += reflectedSky * (0.035 + recentlyWashed * 0.025);
    colour = mix(colour, wetTerrain, recentlyWashed);
  }
#endif
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
