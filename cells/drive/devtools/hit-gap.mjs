/**
 * HOW FAR FROM A BARRIER DOES THE TRUCK ACTUALLY STOP?
 *
 * Reported from the seat: collisions with road barriers and buildings trigger
 * far too early, "like a metre from the barrier". The collision is a CIRCLE of
 * `CAR_R` about the truck's centre, pushed out of any wall segment inside it —
 * and a circle that circumscribes a rectangle is the right size at one point
 * only. `CAR_R`'s own comment says which: "a real car's half-diagonal plus a
 * whisker", which is the CORNER. Everywhere else the circle stands proud of the
 * hull, and at the FLANK — where a long vehicle is narrow — by the most.
 *
 * So the reading is the GAP: the distance from the barrier to the nearest part
 * of the truck's own drawn hull, at rest against it, as a function of the angle
 * the truck is turned. It is not `CAR_R` minus a constant, because which part
 * of the hull faces the wall changes with the angle; the hull is projected onto
 * the wall's normal exactly as a support function.
 *
 * The truck is PLACED against the wall and pushed, rather than driven at it:
 * driving adds the frame's own integration to the measurement and a bounce to
 * the result. The push-out is what decides where it rests, and it runs every
 * frame from the state, so writing a position inside the wall and reading it
 * back after a frame IS the rule under test, with nothing else in it.
 *
 * NODRAW throughout: the quantity is metres between two positions, not pixels.
 */
import { openDrive } from './harness.mjs';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
/** A FIXTURE by default, and not for speed: a live spot has to stream a wall
 *  before there is anything to measure, and the first run of this tool waited
 *  out 200 s at Chapman's Peak and reported "no wall" — a measurement of the
 *  relay. `at-paris-west` is 3,794 footprints that have already arrived, so
 *  what is being read is the push-out and nothing else. SPOT= takes a live
 *  place instead; KIND=rail|wall picks which barrier to stand against. */
const FIX = process.env.FIX ?? (process.env.SPOT ? '' : 'at-paris-west');
const KIND = process.env.KIND || 'wall';
const SPOT = process.env.SPOT || '-34.0877,18.4185,120';   // Chapman's Peak — rails and rock
const SECS = num(process.env.SECS, 200);
const ARGS = process.env.ARGS || '';
const [lat, lon, h] = SPOT.split(',').map(Number);

const run = async () => {
  const q = `?lat=${lat}&lon=${lon}&h=${h}&cam=chase&time=NOON&wx=clear&nodraw=1${ARGS ? `&${ARGS}` : ''}`;
  const d = await openDrive({ spot: q, tag: 'hitgap', settle: 0, bootTimeout: 240000 });
  try {
    const box = await d.page.evaluate(() => window.__rigbox());
    console.log('── THE HULL THE CIRCLE STANDS IN FOR ──');
    console.log(`half-width ${box.halfWidthM} m · half-length ${box.halfLengthM} m`
      + ` · half-diagonal ${box.halfDiagM} m · CAR_R ${box.carR} m`);
    console.log(`so the circle stands proud of the hull by`
      + ` ${box.standoffAheadM} m head-on and ${box.standoffFlankM} m at the flank\n`);

    // Wait for the SEGMENT this will stand against, not for a count: with no
    // barrier in the world there is nothing to measure, and an empty result
    // would read as a collision that never fires rather than as a place with
    // no walls in it yet. The first cut of this gate polled `__built().wallCells`,
    // which is not on that probe — so it read `?? 0` for ever and timed out at
    // a fixture holding 3,794 footprints. Poll the thing the measurement needs.
    const t0 = Date.now();
    let near = null;
    for (;;) {
      near = await d.page.evaluate((k) => (window.__wallnear ? window.__wallnear(k) : null), KIND);
      if (near) break;
      if (Date.now() - t0 > SECS * 1000) {
        const seen = await d.page.evaluate(() => ({
          rails: (window.__rails?.() ?? []).length, walls: (window.__walls?.() ?? []).length }));
        throw new Error(`no ${KIND} long enough to stand against; the world holds `
          + `${seen.rails} rails and ${seen.walls} building edges`);
      }
      await d.page.waitForTimeout(2000);
    }
    console.log(`standing against a ${KIND}: a ${near.lenM} m segment `
      + `${near.distM} m from the truck\n`);

    const rows = await d.page.evaluate(async (KIND_) => {
      const w = window;
      const out = [];
      const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
      // The nearest wall segment to the truck, with its own direction — the
      // measurement's subject, picked by the world rather than by the tool.
      const seg = w.__wallnear ? w.__wallnear(KIND_) : null;
      if (!seg) return [{ err: 'no segment' }];
      const sx = seg.bx - seg.ax, sz = seg.bz - seg.az;
      const L = Math.hypot(sx, sz) || 1;
      const ux = sx / L, uz = sz / L;            // along the wall
      const nx = -uz, nz = ux;                   // its normal
      const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
      for (const deg of [0, 15, 30, 45, 60, 75, 90]) {
        // Heading measured FROM the wall's normal: 0 is driving straight at it,
        // 90 is running along it. The world's heading convention is
        // (sin h, cos h) for forward, so the heading that points along -normal
        // is solved rather than guessed.
        const a = (deg * Math.PI) / 180;
        // forward = the normal rotated by `a`, pointing INTO the wall.
        const fx = -(nx * Math.cos(a) - nz * Math.sin(a));
        const fz = -(nx * Math.sin(a) + nz * Math.cos(a));
        // THE HEADING THAT POINTS A GIVEN WAY, and the first cut of this tool
        // had it wrong: forward is (sin h, -cos h) — `state.z -= cos(h)·v·dt`
        // in the integration — not (sin h, cos h). Inverting the wrong pair
        // mislabelled every angle in the table it printed. `atan2(fx, -fz)`
        // is the inverse of the real one.
        const heading = Math.atan2(fx, -fz);
        // Start well inside the wall and let the push-out settle. Starting
        // outside and driving in measures the integrator; starting inside
        // measures the push-out, which is the rule that decides where it rests.
        const dr = w.__drive;
        dr.x = mx - nx * 0.2; dr.z = mz - nz * 0.2;
        dr.heading = heading; dr.speed = 0;
        for (let i = 0; i < 12; i++) await frame();
        // Where it rests, measured along the wall's own normal.
        const px = dr.x - mx, pz = dr.z - mz;
        const along = px * nx + pz * nz;         // signed distance from the wall
        const centre = Math.abs(along);
        // THE HULL'S OWN REACH TOWARD THE WALL: the support function of the
        // box in the car's frame, evaluated along the wall normal. This is the
        // part of the truck nearest the barrier, and `centre` minus it is the
        // gap a driver sees.
        const side = Math.sign(along) || 1;
        const qx = -nx * side, qz = -nz * side;  // unit vector from truck toward wall
        // The direction toward the wall in the CAR's axes — across and along.
        // right = (cos h, sin h), forward = (sin h, -cos h); see hull-collide.ts.
        const cx = qx * Math.cos(heading) + qz * Math.sin(heading);
        const cz = qx * Math.sin(heading) - qz * Math.cos(heading);
        const reach = Math.abs(cx) * w.__rigbox().halfWidthM
          + Math.abs(cz) * w.__rigbox().halfLengthM;
        out.push({ deg, centre: +centre.toFixed(3), reach: +reach.toFixed(3),
          gap: +(centre - reach).toFixed(3), sl: !!seg.sl });
      }
      return out;
    }, KIND);

    console.log('── WHERE IT RESTS ──');
    console.log('angle   centre from wall   hull reach   GAP');
    for (const r of rows) {
      if (r.err) { console.log(r.err); continue; }
      console.log(`${String(r.deg).padStart(3)}°   ${String(r.centre).padStart(12)} m`
        + `   ${String(r.reach).padStart(8)} m   ${String(r.gap).padStart(6)} m`);
    }
    const gaps = rows.filter((r) => !r.err).map((r) => r.gap);
    if (gaps.length) {
      console.log(`\nworst gap ${Math.max(...gaps).toFixed(2)} m at `
        + `${rows.find((r) => r.gap === Math.max(...gaps)).deg}°`
        + `, best ${Math.min(...gaps).toFixed(2)} m`);
      // The bar is the art pixel, not a taste: at the chase camera's stand-off
      // the frame is ~307 px per metre at one metre, so a barrier the truck
      // stops a quarter of a metre short of is several pixels of daylight and
      // is what the seat is reporting. Half a metre is unmistakable.
      console.log(`\n${Math.max(...gaps) <= 0.5 ? 'ok' : 'FAIL'}  `
        + `the hull stops within half a metre of the barrier at every angle`);
    }
    console.log(`\npage errors ${d.errors.length}`);
  } finally { await d.close(); }
};
run().catch((e) => { console.error(e); process.exit(1); });
