// ── THE ROOF PIECES FACE OUT ──
//
// A triangle's winding-derived normal is (b−a) × (c−a), which is exactly what
// three's `computeVertexNormals` writes into the attribute. Under a DoubleSide
// material an inside-out face is invisible to every test that looks at the
// picture — three flips the shading normal toward the viewer, so the surface
// is lit, just not by the sun that is actually on it — and that is how every
// roof plane in this game came to carry a downward normal for as long as
// roofGeo has existed. Measured, before the fix, on a plain 12 × 8 plan:
//
//     roofGeo gabled    roof 0 outward, 10 INWARD   wall 1 outward, 1 INWARD
//     roofGeo hipped    roof 0 outward, 12 INWARD
//     roofGeo pyramidal roof 0 outward,  4 INWARD
//     chimneyGeo        cap  0 outward,  2 INWARD   wall 2 outward, 6 INWARD
//     extrusion         cap  0 outward,  4 INWARD   wall 0 outward, 8 INWARD
//
// The invariant this asserts is stated in terms of what the generators emit:
// every face is either EXACTLY VERTICAL (a gable end, a skillion's eave wall,
// a stack's side, a parapet's skin) or an upward-facing surface (a plane, a
// hip, a cap, a ridge tile, a coping). So a vertical face points away from its
// piece's own axis and everything else points up — with two deliberate
// exceptions the test knows about: a closed extrusion has a FLOOR that faces
// down, and a parapet has an INNER skin that faces in.
//
// It also asserts the attribute agrees with the winding, which is the separate
// fault under the extrusion: `polygon` MIRRORS its box with scale(1, −1, 1),
// and applyMatrix4 transforms the normal attribute while leaving the index
// alone. The `extrusion as shipped` row is the control — it must FAIL both
// halves, or the test is not measuring the bug it names.
//
// Pure node, no browser, under a second. `node devtools/roof-wind.test.mjs`.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CELL = dirname(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = join(CELL, '..', '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'roofwind');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.ts'),
  `export { roofGeo, chimneyGeo, flatRoofGeo } from ${JSON.stringify(join(CELL, 'client', 'roof'))};\n`);
execFileSync('npx', ['esbuild', join(OUT, 'entry.ts'), '--bundle', '--format=esm', '--platform=node',
  '--external:three', '--outfile=' + join(OUT, 'roof.mjs'), '--log-level=error'],
  { cwd: ROOT, stdio: 'inherit' });

const THREE = await import('three');
const R = await import(join(OUT, 'roof.mjs') + '?v=' + Date.now());

let fails = 0;
const ok = (pass, line) => { if (!pass) fails++; console.log(`${pass ? '  ok  ' : 'FAIL  '}${line}`); };

/** Every triangle of a group as {mid, n (winding), na (attribute)}. */
function tris(geo, g) {
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  const out = [];
  for (let t = g.start; t < g.start + g.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t);
    const b = new THREE.Vector3().fromBufferAttribute(pos, t + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.length() < 1e-9) continue;
    out.push({
      mid: a.clone().add(b).add(c).multiplyScalar(1 / 3), n: n.normalize(),
      na: new THREE.Vector3().fromBufferAttribute(nor, t),
      pts: [a, b, c],
    });
  }
  return out;
}
const groups = (geo) => geo.groups.length ? geo.groups
  : [{ start: 0, count: geo.getAttribute('position').count, materialIndex: 0 }];
/** The plan's centre, the closing repeat not voting. */
function centre(pts) {
  const r = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > 1e-6);
  let x = 0, z = 0;
  for (const [px, pz] of r) { x += px; z += pz; }
  return [x / r.length, z / r.length, r];
}

/** roofGeo and chimneyGeo: up, or vertical and away from `ref`. */
function audit(name, geo, pts, ref, solidY) {
  if (!geo) { ok(false, `${name}: null`); return; }
  const [cx0, cz0] = centre(pts);
  const cx = ref ? ref[0] : cx0, cz = ref ? ref[1] : cz0;
  for (const g of groups(geo)) {
    let good = 0, bad = 0, disagree = 0;
    for (const t of tris(geo, g)) {
      if (t.n.dot(t.na) < 0.999) disagree++;
      let pass;
      if (solidY !== undefined) {
        // A CLOSED BOX has a floor, and a floor faces DOWN: the reference is
        // the solid's own centre in three dimensions.
        pass = t.n.dot(new THREE.Vector3(t.mid.x - cx, t.mid.y - solidY, t.mid.z - cz).normalize()) > 0;
      } else {
        pass = t.n.y > 1e-3 || (Math.abs(t.n.y) < 1e-3
          && t.n.dot(new THREE.Vector3(t.mid.x - cx, 0, t.mid.z - cz).normalize()) > 0);
      }
      if (pass) good++; else bad++;
    }
    ok(bad === 0 && disagree === 0,
      `${name} g${g.materialIndex}(${g.materialIndex === 0 ? 'roof' : 'wall'}): outward ${good} INWARD ${bad} attr-vs-winding DISAGREE ${disagree}`);
  }
}

/** flatRoofGeo, by its own rule: the parapet's outer skin and coping face out
 *  and up, its INNER skin faces in, and a rooftop unit is a little box whose
 *  sides face away from its own cap. */
function auditFlat(name, pts, height, want) {
  const geo = R.flatRoofGeo(pts, 6, height, 9812734);
  if (!geo) { ok(false, `${name}: null`); return; }
  const [cx, cz, ring] = centre(pts);
  // Distance from a point to the ring's boundary, so a parapet skin can be
  // told from a unit's side by WHERE IT IS rather than by how tall it is — a
  // half-metre vent sits inside the parapet's own height band.
  const distToRing = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
      best = Math.min(best, Math.hypot(x - (x1 + t * dx), z - (z1 + t * dz)));
    }
    return best;
  };
  const caps = [];                       // each unit's cap centre, in plan
  for (const g of groups(geo)) {
    if (g.materialIndex !== 0) continue;
    for (const t of tris(geo, g)) caps.push(t.mid);
  }
  const c = { outer: 0, coping: 0, inner: 0, unit: 0, cap: 0, BAD: 0 };
  let disagree = 0;
  for (const g of groups(geo)) {
    for (const t of tris(geo, g)) {
      if (t.n.dot(t.na) < 0.999) disagree++;
      const away = new THREE.Vector3(t.mid.x - cx, 0, t.mid.z - cz).normalize();
      if (g.materialIndex === 0) { t.n.y > 0.999 ? c.cap++ : c.BAD++; continue; }
      if (Math.abs(t.n.y) > 1e-3) { t.n.y > 0.999 ? c.coping++ : c.BAD++; continue; }
      if (distToRing(t.mid.x, t.mid.z) < 0.6) {
        // A parapet skin: outward at the ring's own line, inward one thickness in.
        (t.n.dot(away) > 0 ? c.outer++ : c.inner++);
        continue;
      }
      // A unit's side: away from the nearest cap's centre.
      let near = null, bd = Infinity;
      for (const q of caps) {
        const d = Math.hypot(q.x - t.mid.x, q.z - t.mid.z);
        if (d < bd) { bd = d; near = q; }
      }
      if (near && t.n.dot(new THREE.Vector3(t.mid.x - near.x, 0, t.mid.z - near.z).normalize()) > 0) c.unit++;
      else c.BAD++;
    }
  }
  const line = `${name}: parapet outer ${c.outer} coping ${c.coping} inner ${c.inner} · unit sides ${c.unit} cap tris ${c.cap} · BAD ${c.BAD} · DISAGREE ${disagree}`;
  ok(c.BAD === 0 && disagree === 0 && c.outer > 0 && c.inner === c.outer
    && (want === undefined || c.cap / 2 === want), line);
}

const rect = [[-6, -4], [6, -4], [6, 4], [-6, 4], [-6, -4]];    // closed, as OSM sends it
const L = [[-9, -5], [3, -5], [3, 1], [9, 1], [9, 7], [-9, 7], [-9, -5]];
const big = [[-14, -9], [14, -9], [14, 9], [-14, 9], [-14, -9]];
const tower = [[-3, -2.8], [3, -2.8], [3, 2.8], [-3, 2.8], [-3, -2.8]];
const shed = [[-2, -1.6], [2, -1.6], [2, 1.6], [-2, 1.6], [-2, -1.6]];

for (const shape of ['gabled', 'hipped', 'pyramidal', 'skillion']) {
  audit(`roofGeo ${shape}`, R.roofGeo(rect, shape, 6, 2.5), rect);
}
// A stack stands a metre in from the gable end: its own axis is the reference.
audit('chimneyGeo', R.chimneyGeo(rect, 'gabled', 6, 2.5, 2), rect, [-5, 0]);

auditFlat('flatRoofGeo 12x8 (CCW ring)', rect, 7.4, 0);
auditFlat('flatRoofGeo 12x8 (CW ring)', [...rect].reverse(), 7.4, 0);
auditFlat('flatRoofGeo L-plan (reflex corner)', L, 7.4, 1);
auditFlat('flatRoofGeo 28x18 (plant on it)', big, 11, 3);
auditFlat('flatRoofGeo tower (parapet on height alone)', tower, 22, 0);
ok(R.flatRoofGeo(shed, 6, 3, 7) === null, 'flatRoofGeo: a 12.8 m² lean-to keeps its lid (null)');
// A PLAN NARROWER THAN TWO PARAPETS. 40 m by 0.5 m is 20 m² — past the area
// gate — and its inset ring would cross itself, inverting every inner face
// along its length. OSM tags walls and platforms as buildings.
const sliver = [[-20, -0.25], [20, -0.25], [20, 0.25], [-20, 0.25], [-20, -0.25]];
ok(R.flatRoofGeo(sliver, 6, 4, 11) === null, 'flatRoofGeo: a 40 x 0.5 m wall keeps its lid (null)');

// Determinism: the same id is the same roof, a different id is a different one.
{
  const a = R.flatRoofGeo(big, 6, 11, 4242), b = R.flatRoofGeo(big, 6, 11, 4242),
    d = R.flatRoofGeo(big, 6, 11, 4243);
  const bytes = (g) => Array.from(g.getAttribute('position').array).join(',');
  ok(bytes(a) === bytes(b), 'flatRoofGeo: the same id builds the same roof, byte for byte');
  ok(bytes(a) !== bytes(d), 'flatRoofGeo: a different id builds a different one');
}

// ── THE CONTROLS ──
// The extrusion as polygon() builds it must FAIL both halves; with the index
// reversed it must pass. A regression test that does not fail on the bug it
// names is decoration.
const shp = new THREE.Shape(rect.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)));
const extrusion = (flip) => {
  const ex = new THREE.ExtrudeGeometry(shp, { depth: 7.4, bevelEnabled: false });
  ex.rotateX(Math.PI / 2);
  ex.scale(1, -1, 1);
  if (!flip) return ex;
  for (const attr of Object.values(ex.attributes)) {
    const arr = attr.array, n = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i = (t + 1) * n + k, j = (t + 2) * n + k;
        const s = arr[i]; arr[i] = arr[j]; arr[j] = s;
      }
    }
  }
  return ex;
};
{
  const before = fails;
  audit('CONTROL extrusion as ExtrudeGeometry builds it', extrusion(false), rect, null, -1.4 + 7.4 / 2);
  const caught = fails - before;
  fails = before;
  ok(caught > 0, `CONTROL: the mirrored extrusion fails the invariant (${caught} group(s)) — the test can see the bug`);
}
audit('extrusion with the index reversed', extrusion(true), rect, null, -1.4 + 7.4 / 2);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
