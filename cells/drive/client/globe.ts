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
  uBase: { value: THREE.Texture | null };
  /** The sun as a direction in the EARTH frame — see `subsolar`. */
  uSun: { value: THREE.Vector3 };
  /** 0 hides the globe entirely; ramps in as the chart passes the plane's
   *  reach, so the backdrop does not pop into a driving-zoom frame. */
  uOn: { value: number };
  /** The night side's floor: cities are not modelled, so it is moonlight. */
  uNight: { value: number };
}

export function globeMaterial(u: GlobeUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: true,
    vertexShader: `
      varying vec3 vN;
      varying vec3 vView;
      varying vec2 vUv;
      void main() {
        vN = normalize(position);
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uBase;
      uniform vec3 uSun;
      uniform float uOn;
      uniform float uNight;
      varying vec3 vN;
      varying vec3 vView;
      varying vec2 vUv;
      void main() {
        if (uOn < 0.004) discard;
        vec3 base = texture2D(uBase, vUv).rgb;
        // THE TERMINATOR IS A BAND, NOT A LINE. Twilight on Earth is about
        // eighteen degrees of arc — the sun below the horizon and the sky
        // still lit — which is 0.31 of a radian and a visible width of planet
        // at this scale. A hard step there reads as a rendering fault; this
        // is the one place on the globe where a soft edge is the honest one.
        float d = dot(vN, uSun);
        float lit = smoothstep(-0.31, 0.10, d);
        // Warmth along the terminator, for the same reason the sky has a
        // twilight band: the light that reaches it has come the long way
        // through the atmosphere.
        float dusk = (1.0 - abs(d) / 0.31) * step(abs(d), 0.31);
        vec3 col = base * mix(uNight, 1.0, lit);
        col += base * vec3(0.28, 0.13, 0.04) * dusk * 0.6;
        // THE LIMB, which is the whole of the atmosphere this view can show.
        // Fresnel on the view, so it is a rim wherever you stand rather than a
        // ring painted at a fixed place — and lit, so the night side's limb
        // goes out.
        float rim = pow(1.0 - clamp(dot(vN, vView), 0.0, 1.0), 3.5);
        col += vec3(0.20, 0.34, 0.52) * rim * (0.25 + 0.75 * lit);
        gl_FragColor = vec4(col, uOn);
      }`,
  });
}
