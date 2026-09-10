/**
 * THE GLOBE'S MATHS, HELD — pure node, no browser, seconds.
 *
 *   node cells/drive/devtools/globe.test.mjs
 *
 * Every assertion here is about a SIGN or a FRAME, because that is the only
 * way this module can be wrong in a way that looks plausible. This file has
 * recorded a hemisphere-symmetric sign error before (`insolation` read every
 * pole-facing slope as sunny and every sunny one as shaded, and nine climate
 * fixtures agreed with it because the fixture was built from the same wrong
 * premise). So the checks are stated as physical facts that can be verified
 * without reading the code: the sun is over your own meridian at local noon,
 * the December solstice puts it in the southern hemisphere, and the rotation
 * that carries your position to "up" must carry north to the world's −Z.
 */
import { strict as assert } from 'node:assert';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
const BUNDLE = join(CELL, 'node_modules', '.cache', 'globe.test.mjs');
await build({ entryPoints: [join(CELL, 'client/globe.ts')], outfile: BUNDLE,
  // three stays EXTERNAL and is resolved by node from the bundle's own
  // directory upward, which finds the workspace copy. An `alias` beside
  // `external` does not do that — esbuild resolves the alias and then externals
  // it to a path it has already discarded, and the module arrives as
  // `new (void 0)()`, which is a constructor error four frames from anything
  // that names three.
  bundle: true, format: 'esm', platform: 'node', logLevel: 'error', external: ['three'] });
const G = await import(`file://${BUNDLE}?${Date.now()}`);
const THREE = await import('three');

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const v = (lat, lon) => G.latLonToUnit(lat, lon);

console.log('the globe frame:');
check(near(v(0, 0).x, 1), '(0N, 0E) is +X');
check(near(v(90, 0).y, 1), 'the north pole is +Y');
check(near(v(0, 180).x, -1, 1e-9), '(0N, 180E) is −X');
check(near(v(-90, 0).y, -1), 'the south pole is −Y');
// THE BASIS IS DERIVED, NOT RESTATED. `globeEast`/`globeNorth` are analytic
// derivatives of `latLonToUnit`, so a test that writes them out again is a
// test that can agree with a wrong premise — which is exactly how a
// hemisphere-symmetric sign error once passed nine climate fixtures. Finite
// differences of the shipped function are an independent witness.
const fd = (lat, lon, dLat, dLon) => {
  const h = 1e-4;
  const a = v(lat - dLat * h, lon - dLon * h), b = v(lat + dLat * h, lon + dLon * h);
  return b.clone().sub(a).normalize();
};
for (const [lat, lon] of [[0, 0], [-33.93, 18.42], [51.5, -0.1], [-29.99, 24.78], [78, 150]]) {
  const e = fd(lat, lon, 0, 1), n = fd(lat, lon, 1, 0);
  const de = e.dot(G.globeEast(lat, lon)), dn = n.dot(G.globeNorth(lat, lon));
  check(near(de, 1, 1e-6) && near(dn, 1, 1e-6),
    `${lat}°,${lon}°: globeEast·∂lon ${de.toFixed(6)}, globeNorth·∂lat ${dn.toFixed(6)}`);
}
// And the frame must be RIGHT-handed with the world's axes, or no rotation
// can carry it there. This is the check that failed first, at det = −1.
for (const [lat, lon] of [[0, 0], [-33.93, 18.42], [78, 150]]) {
  const e = G.globeEast(lat, lon), u = v(lat, lon), s = G.globeNorth(lat, lon).negate();
  const det = e.dot(u.clone().cross(s));
  check(near(det, 1, 1e-6), `${lat}°,${lon}°: (east, up, south) is right-handed, det ${det.toFixed(6)}`);
}

console.log('\nthe sun, from the game\'s own clock:');
{
  // Local noon at the origin's meridian: the sun is over that meridian. This
  // is the definition of noon, so it is the one assertion that cannot be
  // wrong for an interesting reason.
  for (const lon of [0, 18.42, -121.81, 179.5, -179.5]) {
    const s = G.subsolar(12, lon);
    check(near(((s.lon - lon + 540) % 360) - 180, 0, 1e-9), `local noon at ${lon}°: sun over ${s.lon.toFixed(2)}°`);
  }
  const mid = G.subsolar(0, 30);
  check(near(Math.abs(((mid.lon - 30 + 540) % 360) - 180), 180, 1e-9), 'local midnight puts the sun on the antipodal meridian');
  // The seasons, by their real dates. Getting this backwards would light the
  // Antarctic in June and nothing else would notice.
  const dec = G.subsolar(12, 0, new Date(Date.UTC(2026, 11, 21)));
  const jun = G.subsolar(12, 0, new Date(Date.UTC(2026, 5, 21)));
  check(dec.lat < -22, `December solstice: sun ${dec.lat.toFixed(1)}° — southern`);
  check(jun.lat > 22, `June solstice: sun ${jun.lat.toFixed(1)}° — northern`);
  const mar = G.subsolar(12, 0, new Date(Date.UTC(2026, 2, 20)));
  check(Math.abs(mar.lat) < 2.5, `equinox: sun ${mar.lat.toFixed(1)}° — on the equator`);
  // AND IT AGREES WITH THE SUN'S HEIGHT IN THE SKY. At local noon the solar
  // elevation is 90 − |lat − declination|, so the dot of the normal with the
  // sun is its sine. This is the number the world's own sky is built from, so
  // if the globe's dawn is ever to match the seat's, it is this that has to.
  for (const [lat, lon] of [[-33.93, 18.42], [48.86, 2.35], [-29.99, 24.78], [64.1, -21.9]]) {
    const s = G.subsolar(12, lon);
    const dot = v(lat, lon).dot(v(s.lat, s.lon));
    const want = Math.sin(((90 - Math.abs(lat - s.lat)) * Math.PI) / 180);
    check(near(dot, want, 1e-9), `noon elevation at ${lat}°: sin(alt) ${dot.toFixed(6)} = ${want.toFixed(6)}`);
  }
  // Dawn and dusk straddle it, in the right order — the sun rises in the east,
  // so a place is lit later as you go west.
  const at = (h) => { const s = G.subsolar(h, 0); return v(0, 0).dot(v(s.lat, s.lon)); };
  check(at(6) < at(9) && at(9) < at(12) && at(12) > at(15) && at(15) > at(18),
    `the sun climbs to noon and sets: ${[6, 9, 12, 15, 18].map((h) => at(h).toFixed(2)).join(' ')}`);
}

console.log('\nthe orientation carries the earth into the world:');
for (const [lat, lon] of [[0, 0], [-33.93, 18.42], [51.5, -0.1], [-29.99, 24.78], [78, 150]]) {
  const q = G.globeOrientation(lat, lon);
  const up = v(lat, lon).clone().applyQuaternion(q);
  const north = G.globeNorth(lat, lon).applyQuaternion(q);
  const east = G.globeEast(lat, lon).applyQuaternion(q);
  const ok = near(up.y, 1, 1e-6) && near(north.z, -1, 1e-6) && near(east.x, 1, 1e-6);
  check(ok, `${lat}°,${lon}° → up +Y (${up.y.toFixed(4)}), north −Z (${north.z.toFixed(4)}), east +X (${east.x.toFixed(4)})`);
}

console.log('\nthe far plane clears the horizon:');
for (const h of [50e3, 200e3, 796e3, 2e6, 2e7]) {
  const horizon = Math.sqrt(h * h + 2 * G.GLOBE_R * h);
  const far = G.globeFar(h);
  check(far > horizon, `${(h / 1000).toFixed(0)}km up: horizon ${(horizon / 1000).toFixed(0)}km, far plane ${(far / 1000).toFixed(0)}km`);
}
check(G.globeFar(2e7) >= 8e7, 'and it never falls below the chart\'s own dist × 4');

console.log('\nthe geometry, and its agreement with the bake:');
{
  const g = G.globeGeometry(64, 32);
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  let worstR = 0;
  for (let i = 0; i < p.count; i++) {
    worstR = Math.max(worstR, Math.abs(Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) - G.GLOBE_R));
  }
  check(worstR < 1, `every vertex is on the sphere (worst ${worstR.toFixed(3)}m of ${G.GLOBE_R})`);
  // The bake writes row 0 at +90° and column 0 at −180°, and loads with flipY
  // off. So uv (0,0) must be the north pole and uv (0.5,0.5) must be (0N, 0E)
  // — get this wrong by a half turn and the Atlantic lands on Asia.
  const find = (u, vv) => {
    for (let i = 0; i < uv.count; i++) if (near(uv.getX(i), u, 1e-6) && near(uv.getY(i), vv, 1e-6)) return i;
    return -1;
  };
  const np = find(0, 0), mid = find(0.5, 0.5), w = find(0, 0.5);
  check(np >= 0 && near(p.getY(np), G.GLOBE_R, 1), 'uv (0,0) is the north pole — the bake\'s first row');
  check(mid >= 0 && near(p.getX(mid), G.GLOBE_R, 1), 'uv (0.5,0.5) is (0°N, 0°E) — the bake\'s centre');
  check(w >= 0 && near(p.getX(w), -G.GLOBE_R, 1), 'uv (0,0.5) is (0°N, 180°W) — the bake\'s first column');
  check(g.getIndex().count === 64 * 32 * 6, `${g.getIndex().count / 3} triangles`);
}

// ── THE TAP: A RAY BACK TO A LAT/LON ──
//
// `globeHit` is the exact inverse of `latLonToUnit` through a rotation, and
// that is precisely the kind of thing that can be wrong by a sign or a mirror
// and still return plausible coordinates for the one case its author tried.
// So it is asserted as a ROUND TRIP over a spread of places, at two spins, and
// then on the two cases that are not places at all.
{
  const centre = new THREE.Vector3(0, -G.GLOBE_R - 800, 0);
  // The eye 20,000km over the tangent point, which is the chart's own ceiling.
  const eye = new THREE.Vector3(0, 20e6, 0);
  for (const [spinLat, spinLon] of [[0, 0], [-34, 18.4], [41, -74]]) {
    const q = G.globeOrientation(spinLat, spinLon);
    let worst = 0, worstAt = '';
    for (const [lat, lon] of [[0, 0], [45, 90], [-34, 18.4], [60, -120], [-70, 170], [12, -3]]) {
      // Aim at where that place actually IS under this spin, then ask the ray
      // what it hit. A round trip through the rotation, the intersection and
      // the inverse, which is every step the gesture takes.
      const p = G.latLonToUnit(lat, lon).multiplyScalar(G.GLOBE_R)
        .applyQuaternion(q).add(centre);
      // ONLY WHAT IS OVER THE HORIZON FROM THIS EYE, and the horizon is not a
      // guess: from height h the visible cap reaches exactly where the
      // surface normal's component toward the eye is R/(R+h), which at 20,000
      // km is 0.2416 — 76 degrees of arc. The first cut of this filter used a
      // round 0.2, which is 78.5 degrees and therefore BEYOND the horizon, and
      // it duly failed by 2.9 degrees on the one place that landed in the
      // sliver between: the ray toward a point behind the limb hits the near
      // limb instead, correctly, and the round trip has nothing to round trip
      // to. A tenth of a degree of margin keeps a grazing case off the knife
      // edge, where the intersection is ill-conditioned for reasons that are
      // arithmetic rather than geometric.
      const eyeH = eye.y - (centre.y + G.GLOBE_R);
      if (p.y < centre.y + G.GLOBE_R * (G.GLOBE_R / (G.GLOBE_R + eyeH) + 0.02)) continue;
      const dir = p.clone().sub(eye).normalize();
      const hit = G.globeHit(eye, dir, centre, q);
      if (!hit) { worst = 1e9; worstAt = `${lat},${lon} missed`; continue; }
      const dLat = Math.abs(hit.lat - lat);
      const dLon = Math.abs((((hit.lon - lon) % 360) + 540) % 360 - 180);
      if (Math.max(dLat, dLon) > worst) { worst = Math.max(dLat, dLon); worstAt = `${lat},${lon}`; }
    }
    check(worst < 1e-3, `spin ${spinLat},${spinLon}: every tap round-trips (worst ${worst.toFixed(6)}° at ${worstAt})`);
  }
  const q0 = G.globeOrientation(0, 0);
  // THE NEAR FACE, NOT THE FAR ONE. A ray straight down the axis must answer
  // with the place under the eye, never its antipode — the whole reason the
  // quadratic takes the smaller root.
  const down = G.globeHit(eye, new THREE.Vector3(0, -1, 0), centre, q0);
  check(down !== null && Math.abs(down.lat) < 1e-6 && Math.abs(down.lon) < 1e-6,
    `straight down is the tangent point, not its antipode (${down ? `${down.lat.toFixed(3)},${down.lon.toFixed(3)}` : 'null'})`);
  // A TAP ON SPACE IS NULL. Sideways from the eye passes clean by the planet,
  // and clamping that onto the limb would drop a mark nobody pointed at.
  check(G.globeHit(eye, new THREE.Vector3(1, 0, 0), centre, q0) === null,
    'a ray past the limb hits nothing');
  // And a ray pointing away from a planet that is behind you is not a hit
  // either, however real the roots are.
  check(G.globeHit(eye, new THREE.Vector3(0, 1, 0), centre, q0) === null,
    'a ray away from the planet hits nothing');
}

rmSync(BUNDLE, { force: true });
console.log(fails ? `\n${fails} FAILURES` : '\nglobe: all ok');
process.exit(fails ? 1 : 0);
