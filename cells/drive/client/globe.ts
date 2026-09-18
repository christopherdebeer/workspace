import * as THREE from 'three';

/**
 * THE PLANET, WHERE THE PLANE STOPS BEING HONEST.
 *
 * Tier 1 stretched the chart's tangent plane to 1,500km, which is as far as it
 * goes: `toLocal` is equirectangular scaled by cos(origin.lat), so a point ten
 * degrees from the truck is placed 8% too wide at 30° of latitude, and the
 * curvature compensation the far shell carries is first-order. Past that the
 * answer is not a wider plane, it is a sphere.
 *
 * ── IT IS A BACKDROP, NOT A MODE ──
 *
 * The obvious design is a globe VIEW you switch into, with a cross-fade over a
 * zoom band. This is not that, and the reason is geometry rather than taste:
 * the far shell already sinks by d²/2R (see `curveDrop`), which IS the sphere
 * to second order. So a sphere of the same radius, centred one Earth radius
 * beneath the truck, passes through the shell — they agree where they overlap
 * and diverge by 2.5km at 1,500km, which at that scale is a sixth of a percent
 * and invisible. Drawn under everything, it simply fills whatever the streamed
 * world does not, exactly as the shell fills what the fine ring does not. The
 * limb arrives on its own as you pull out. There is no transition to build, no
 * two projections to keep registered, and nothing in the fine world changes.
 *
 * What DOES have to change is the camera: its tilt eases to nothing so the
 * planet is seen face-on rather than obliquely, and its far plane has to clear
 * the horizon (see `globeFar`).
 *
 * ── AND IT IS LIT IN THE EARTH'S OWN FRAME ──
 *
 * The world's `SUN_DIR` is the sun in the TANGENT frame at the origin, which
 * is meaningless a hemisphere away. Here the sun is a direction in the earth
 * frame, from the subsolar point, and the terminator falls out of one dot
 * product. At the truck the two agree by construction — the tangent frame's up
 * IS the sphere's normal there — so the globe's dawn is the world's dawn.
 */

/** Earth's radius in metres. The world is built in metres and the sphere is
 *  drawn at true scale, which keeps every number in the same units as the
 *  shell it has to agree with. Float32 holds a metre at 6.4e6. */
export const GLOBE_R = 6371000;

/**
 * THE GLOBE FRAME, AND WHY ITS LONGITUDE RUNS BACKWARDS.
 *
 * +X through (0°N, 0°E), +Y through the north pole, +Z through (0°N, 90°**W**)
 * — the last of those is the whole point and it is not a slip.
 *
 * The world is `x = east, z = south` (`toLocal`: "north = -z (screen up)"),
 * which puts north up and east right on a chart seen from above and is the
 * right choice for a map. It is also, in three dimensions, LEFT-handed as a
 * geographic frame: east × up is north, and north is −z here, so x̂ × ŷ = −ẑ.
 * A flat tangent plane never notices, because every layer is placed by that
 * same `toLocal` and a mirror about the map's own vertical is invisible.
 *
 * A SPHERE NOTICES. No rotation carries a physically-handed globe into a
 * left-handed frame; only a reflection does, and a reflected mesh draws its
 * texture mirror-imaged — the Atlantic on the wrong side of Africa, correct
 * everywhere you check a coordinate and wrong to anyone who has seen a map.
 * The first cut of this built the honest right-handed earth frame and the test
 * caught it as `det = −1`: five orientations returning garbage, `up` landing
 * at 0.0000 instead of 1.
 *
 * So the mirror is taken ONCE, here, in the frame's own definition, and
 * everything downstream is consistent with it: the geometry, its UVs and the
 * subsolar direction all go through this function, and a reflection applied to
 * both a surface and its light preserves every dot product between them. The
 * terminator is exactly where it would be on the real Earth.
 */
export function latLonToUnit(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}

/**
 * WHERE THE SUN STANDS OVER THE EARTH, from the game's own clock.
 *
 * `hour` is the LOCAL SOLAR HOUR at `originLon` — `clockHour()`, the same
 * number the sky and the shadows are built from — not a wall clock. That is
 * what makes the terminator move when the time dial is dragged and hold still
 * when the clock is pinned, instead of quietly telling real time on a world
 * that is not at real time.
 *
 * Local solar hour H at longitude λ is UTC + λ/15, so the subsolar longitude
 * −15(UTC−12) becomes λ + 180 − 15H. At local noon that is λ: the sun is over
 * the origin's own meridian, which is the definition of noon and the check
 * worth remembering.
 *
 * The declination is the season, and it needs a real date because the clock
 * has only an hour in it. Cosine about the January solstice — good to a
 * fraction of a degree, which on a globe a few hundred pixels across is a
 * fraction of a pixel.
 */
export function subsolar(hour: number, originLon: number, date = new Date()): { lat: number; lon: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = (date.getTime() - start) / 86400000;
  const lat = -23.44 * Math.cos((2 * Math.PI * (day + 10)) / 365.25);
  const lon = (((originLon + 180 - 15 * hour) % 360) + 540) % 360 - 180;
  return { lat, lon };
}

/** North at a point, in the globe frame: ∂/∂lat of `latLonToUnit`. */
export function globeNorth(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return out.set(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
}
/** East at a point, in the globe frame: ∂/∂lon, normalised. */
export function globeEast(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lo = (lon * Math.PI) / 180;
  return out.set(-Math.sin(lo), 0, -Math.cos(lo));
}

/**
 * The rotation that carries the globe frame into the WORLD frame, given the
 * lat/lon standing under the truck.
 *
 * The world's axes there are +X east, +Y up, +Z south. The basis whose columns
 * are (east, up, −north) maps world → globe, and its transpose — a rotation,
 * because the frame above was defined to make it one — is what a mesh in the
 * globe frame needs in order to be drawn in the world's.
 */
export function globeOrientation(lat: number, lon: number, out = new THREE.Quaternion()): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(
    globeEast(lat, lon), latLonToUnit(lat, lon), globeNorth(lat, lon).negate());
  return out.setFromRotationMatrix(m.transpose());
}

/**
 * HOW FAR THE CAMERA MUST SEE, and the reason it is not `dist * 4`.
 *
 * The chart's far plane is four times the stand-off, which is generous for a
 * flat world and WRONG for a round one: what has to be inside it is the
 * horizon, √(h² + 2Rh), and that grows as √h while 4h grows as h. They cross
 * at h = R/8, about 800km — so below that altitude a `dist * 4` plane cuts the
 * globe off mid-ocean. At 200km up the horizon is 1,600km and the plane would
 * stand at 800. A tenth of margin over the horizon, or the chart's own rule
 * where that is already wider.
 */
export function globeFar(dist: number): number {
  return Math.max(dist * 4, Math.sqrt(dist * dist + 2 * GLOBE_R * dist) * 1.1);
}

/**
 * WHERE A RAY MEETS THE PLANET, as a lat/lon — the tap gesture's other half.
 *
 * A double tap on the chart unprojects onto the tangent PLANE, which is the
 * right answer for a map and a meaningless one for a planet: at twenty
 * thousand kilometres up a tap near the limb solves to a point tens of
 * thousands of kilometres out in a plane that stopped describing the Earth
 * around fifteen hundred. So above the hand-over the same ray is intersected
 * with the sphere instead, and the answer comes back in the coordinates the
 * world can actually travel to.
 *
 * THE NEAR ROOT, ALWAYS. Both roots are real for any ray through the planet
 * and the far one is the point on the back of it — a tap on Africa would
 * answer with the Pacific, correctly and uselessly. A ray that misses (a tap
 * on space beside the limb) has no real root and returns null rather than
 * being clamped onto the rim, because "you tapped nothing" is a real answer
 * and a rim tap is not a place.
 *
 * The hit is taken back through the group's own rotation before it is read as
 * a lat/lon, so this is correct whatever the spin has done — and it goes
 * through the same mirrored frame `latLonToUnit` defines, as its exact
 * inverse, which is what keeps a tap and the pin it lands on agreeing.
 */
export function globeHit(
  from: THREE.Vector3, dir: THREE.Vector3,
  centre: THREE.Vector3, quat: THREE.Quaternion,
): { lat: number; lon: number } | null {
  const ox = from.x - centre.x, oy = from.y - centre.y, oz = from.z - centre.z;
  // dir is expected normalised, so a = 1 and the quadratic is the reduced form.
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - GLOBE_R * GLOBE_R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = -b - root >= 0 ? -b - root : -b + root;
  if (t < 0) return null;                       // the planet is behind the eye
  const p = new THREE.Vector3(ox + dir.x * t, oy + dir.y * t, oz + dir.z * t)
    .applyQuaternion(quat.clone().invert())
    .normalize();
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI,
    // −z, because the frame's longitude runs backwards by construction — see
    // `latLonToUnit`, whose z is negated for exactly this reason.
    lon: (Math.atan2(-p.z, p.x) * 180) / Math.PI,
  };
}

/** A lat/lon lattice, so the texture's mapping is the one the bake wrote and
 *  not whichever way three's own sphere happens to run. */
export function globeGeometry(seg = 128, rings = 64): THREE.BufferGeometry {
  const pos = new Float32Array((seg + 1) * (rings + 1) * 3);
  const uv = new Float32Array((seg + 1) * (rings + 1) * 2);
  const v3 = new THREE.Vector3();
  let p = 0, t = 0;
  for (let j = 0; j <= rings; j++) {
    const v = j / rings, lat = 90 - v * 180;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, lon = -180 + u * 360;
      latLonToUnit(lat, lon, v3);
      pos[p++] = v3.x * GLOBE_R; pos[p++] = v3.y * GLOBE_R; pos[p++] = v3.z * GLOBE_R;
      // v runs from the north pole DOWN, matching the equirect bake's first
      // row; the texture is loaded with flipY off so row 0 is +90 either side.
      uv[t++] = u; uv[t++] = v;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // The normal IS the unit position on a sphere, so it is not stored: the
  // shader normalises the local position and saves 100KB of attribute.
  return g;
}

export interface GlobeUniforms {
  /** The sun as a direction in the GLOBE frame — see `subsolar`. */
  uSun: { value: THREE.Vector3 };
  /** The night side's floor: no city lights are modelled, so it is moonlight. */
  uNight: { value: number };
}

/**
 * THE DAY/NIGHT TERM, AS ONE STRING, BECAUSE TWO LAYERS DRAW THIS PLANET.
 *
 * The globe is the backdrop and the far shell is painted over it wherever it
 * has streamed, and the shell had no terminator at all — it is Lambert ground
 * under the scene's ONE directional light, which at planet scale is a single
 * direction for the whole world, so it read as a flat lit patch standing over
 * a globe that was at least trying. Two copies of this arithmetic would drift
 * in a week; main.ts splices this same string into the shell's material.
 *
 * `d` is the cosine between the surface's own radial and the subsolar
 * direction, both in the planet's frame. THE TERMINATOR IS A BAND, NOT A
 * LINE: twilight on Earth is about eighteen degrees of arc — the sun below
 * the horizon and the sky still lit — which is 0.31 of a radian, and a hard
 * step there reads as a rendering fault. It is the one place on this planet
 * where a soft edge is the honest one.
 */
export const PLANET_SUN_GLSL = `
  float planetLit(float d) { return smoothstep(-0.31, 0.10, d); }
  // The day side takes the sun's ANGLE, not a flat "it is daytime", floored
  // so the limb does not go out before the terminator reaches it.
  float planetLam(float d) { return 0.42 + 0.58 * clamp(d, 0.0, 1.0); }
  // Warmth along the terminator, for the same reason the sky has a twilight
  // band: the light that reaches it has come the long way through the air.
  float planetDusk(float d) { return (1.0 - abs(d) / 0.31) * step(abs(d), 0.31); }
  vec3 planetSun(vec3 base, float d, float night) {
    float lit = planetLit(d);
    return base * mix(night, planetLam(d), lit)
      + base * vec3(0.28, 0.13, 0.04) * planetDusk(d) * 0.6;
  }`;

/**
 * OPAQUE, AND THERE IS NO CROSS-FADE. The first cut carried a `uOn` and drew
 * transparent so the backdrop could ease in — which is the instinct a MODE
 * needs and this is not one. The globe is simply behind everything: while the
 * chart is narrow the streamed shell covers it completely, and it becomes
 * visible by the shell ceasing to reach, which is a fade the geometry performs
 * for free and cannot get out of step with. All that is left is a visibility
 * flag, so 16k triangles are not drawn at a driving zoom where nothing could
 * see them.
 *
 * ── AND IT IS A GRATICULE NOW, NOT A PICTURE ──
 *
 * It was `globe-base.png`, a 1024x512 equirectangular bake coloured by this
 * game's own `climCompute`/`groundColourAt` so it could not read as another
 * game's map. Two things retired it. The far shell's ladder now reaches z3
 * and `fRing` is chosen so the 5x5 ring spans the view, so the STREAMED
 * ground covers the visible face by construction — the bake was painting
 * under a layer that had arrived. And the bake is 39km a pixel, so wherever
 * it did show through it was a blurred picture beside crisp streamed tiles.
 *
 * What a backdrop is still for is saying WHERE YOU ARE on a sphere when the
 * tiles have not landed, and a graticule does that better than a blur: it is
 * the same at every zoom, it costs no asset and no fetch, and it cannot go
 * stale against a palette change the way a baked picture does.
 *
 * THE LINES CARRY THE DAY/NIGHT, WHICH THE FILL CANNOT. A dark sphere times
 * 0.42 and the same sphere times 0.14 are both black to a fourteen-level
 * quantiser — measured on the bake it replaces, where the terminator came out
 * as a ratio of 0.6, about ONE palette step, and read as nothing at all. A
 * graticule is a compact feature with a large tonal step across it, so the
 * line tone is what announces the terminator, and it survives the dither.
 *
 * AND THEY ARE DIM ON PURPOSE. "Narrow bright features become white contour
 * diagrams" is this renderer's own doctrine and a wireframe is exactly that
 * shape, so the ink sits well under the 0.62 bloom cut and reads as a drawn
 * line rather than a lit one.
 */

export function globeMaterial(u: GlobeUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    // A SCREEN-CONSTANT LINE NEEDS DERIVATIVES. `fwidth` gives degrees per
    // pixel at this fragment, which is what keeps a meridian the same weight
    // at 2,000km and at 20,000 — and makes the poles, where the meridians
    // converge, widen in lon-space rather than alias into a smear.
    extensions: { derivatives: true } as unknown as THREE.ShaderMaterialParameters['extensions'],
    vertexShader: `
      // TWO NORMALS, IN TWO FRAMES, AND THE FIRST CUT USED ONE FOR BOTH.
      //
      // vN is the normal in the GLOBE's own frame — on a sphere centred at
      // the origin that is just the normalised position — and it is what the
      // sun is dotted with, because uSun is a globe-frame direction.
      // vNv is the same normal in VIEW space, and it is what the limb is
      // dotted with, because the view direction lives there.
      //
      // Using vN for both makes the fresnel compare an object-space normal
      // with a view-space direction: a number with no meaning that happens to
      // be large over most of the disc. It rendered as a blue veil over the
      // whole planet, washing the continents flat and hiding the terminator
      // completely — and it looked enough like atmospheric haze that the
      // composite's fog of war and aerial perspective were both suspected and
      // both measured innocent (uFow defaults to 0; the haze already stands
      // down past the fine world) before the frames were read.
      varying vec3 vN;
      varying vec3 vNv;
      varying vec3 vView;
      varying vec2 vUv;
      void main() {
        vN = normalize(position);
        vNv = normalize(normalMatrix * position);
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uSun;
      uniform float uNight;
      varying vec3 vN;
      varying vec3 vNv;
      varying vec3 vView;
      varying vec2 vUv;
      ${PLANET_SUN_GLSL}
      // How close this fragment is to a line every "period" degrees, as an
      // antialiased 0..1, with "w" the half-width in the same degrees.
      // (NO BACKTICKS IN GLSL COMMENTS — this file is a TS template literal
      // and one backtick ends it. CLAUDE.md has said so three times; this is
      // the fourth.)
      float grat(float deg, float period, float w) {
        float d = abs(fract(deg / period + 0.5) - 0.5) * period;
        return 1.0 - smoothstep(0.0, w, d);
      }
      void main() {
        // The lattice is 2.25 degrees a quad and uv is linear across each, so
        // reading lat/lon from uv rather than from the normal is a fraction of
        // a quad's worth of wobble on a line — invisible, and it costs no
        // trig. (The frame is mirrored, so a normal would have to unmirror.)
        float lon = vUv.x * 360.0 - 180.0;
        float lat = 90.0 - vUv.y * 180.0;
        // Degrees per pixel, so the weight is the same at every altitude.
        float wLon = fwidth(lon) * 0.75;
        float wLat = fwidth(lat) * 0.75;
        // MERIDIANS FADE OUT AT THE POLES, where they converge on a point and
        // any fixed spacing becomes a solid cap of ink.
        float poleFade = smoothstep(0.02, 0.30, cos(radians(lat)));
        float minor = max(grat(lon, 15.0, wLon) * poleFade, grat(lat, 15.0, wLat));
        // The equator, the prime meridian and the tropics are the lines a
        // reader actually navigates by, so they are the ones that carry.
        float major = max(
          max(grat(lon, 90.0, wLon * 1.3) * poleFade, grat(lat, 90.0, wLat * 1.3)),
          grat(abs(lat) - 23.44, 1000.0, wLat));
        float line = max(minor * 0.55, major);
        // ── THE SURFACE ──
        // A deep, nearly black ocean-blue: this is a backdrop that the shell
        // paints over, and anything lighter competes with real ground.
        vec3 fill = vec3(0.030, 0.052, 0.082);
        vec3 ink = vec3(0.20, 0.44, 0.52);
        vec3 base = mix(fill, ink, line);
        float d = dot(vN, uSun);
        vec3 col = planetSun(base, d, uNight);
        // THE LIMB, which is the whole of the atmosphere this view can show.
        // Fresnel on the view, so it is a rim wherever you stand rather than a
        // ring painted at a fixed place — and lit, so the night side's limb
        // goes out. Its night share is 0.10 and not 0.25: at 0.25 the rim was
        // most of what the night side emitted and it flattened the very
        // terminator this material exists to show.
        float rim = pow(1.0 - clamp(dot(vNv, vView), 0.0, 1.0), 3.5);
        col += vec3(0.20, 0.34, 0.52) * rim * (0.10 + 0.90 * planetLit(d));
        gl_FragColor = vec4(col, 1.0);
      }`,
    // THE BACKDROP WRITES NO DEPTH. It is painted first (renderOrder −5) and
    // everything streamed — the far shell, the overview, the fine world — is
    // painted over it wherever it exists, by ORDER, so the shell can stand
    // any distance inside or outside the sphere and still win. It has to:
    // the shell's radius is R + elev − baseElev, the rig's own elevation
    // baked into every far vertex, so from a rig at 2,300m the shell over a
    // plain at 100m is 2.2km inside this sphere and over the sea floor 6km
    // inside it. With depth on, a sink of any fixed size put the lattice's
    // vertices through the shell somewhere (main.ts, at the globe mesh, has
    // the frames). Nothing behind the planet is ever drawn — back faces are
    // culled and the pin and the labels are gated by a near-cap test — so
    // the depth was never doing anything a sphere needs.
    depthWrite: false,
  });
}
