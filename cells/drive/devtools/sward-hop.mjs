/**
 * DOES A HOP CLEAR THE SWARD, AND FOR HOW LONG DOES THE OLD PLACE'S GRASS STAND
 * ON THE NEW GROUND?
 *
 * The reading that matters is not the field's ORIGIN — a hop returns the truck
 * to local (0,0) and the last field was centred on wherever the truck stood, so
 * in the case the seat reported (hop without driving first) the two coincide
 * exactly and the origin says nothing. It is the RESIDUAL: each committed
 * texel's height against the ground that is there now. A field built for this
 * place tracks it; one built for another continent is out by the difference in
 * their elevations.
 *
 * The two legs are two PLACES, chosen so their elevations are far apart, and
 * the hop is taken WITHOUT DRIVING so the `moved` test cannot fire on distance
 * alone — which is the state the report describes and the one a drive would
 * hide. FROM= and TO= move them; DRIVE=<m> drives first, as the control that
 * shows the distance trigger working where it can.
 *
 * NODRAW is the default: the quantity is a CPU field over committed data, and
 * the harness paints at three frames a second with drawing on — which would
 * measure the frame rate rather than the rule. SHOTS=1 takes a chase frame
 * either side instead, and says so.
 */
import { openDrive } from './harness.mjs';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const FROM = process.env.FROM || '-30.75509,27.68403,90';   // Senqu, ~1790 m
const TO = process.env.TO || '-34.0877,18.4185,120';        // Chapman's Peak, ~30 m
const SECS = num(process.env.SECS, 40);
const EVERY = num(process.env.EVERY, 500);
const DRIVE = num(process.env.DRIVE, 0);
const SHOTS = process.env.SHOTS === '1';
const NODRAW = process.env.NODRAW !== '0' && !SHOTS;
/** ARGS='swardhop=0' is the control, and it is ONE BUILD with one flag: a hop
 *  at a live spot streams differently on every boot, so two builds would differ
 *  by the network before they differed by the rule. */
const ARGS = process.env.ARGS || '';

const [flat, flon, fh] = FROM.split(',').map(Number);
const [tlat, tlon, th] = TO.split(',').map(Number);

const read = (d) => d.page.evaluate(() => {
  const w = window;
  const f = w.__swardfield ? w.__swardfield() : null;
  const dr = w.__drive || {};
  return { f, x: +(dr.x ?? 0).toFixed(1), z: +(dr.z ?? 0).toFixed(1),
    builds: w.__tstats ? w.__tstats().builds : null,
    tiles: w.__tstats ? w.__tstats().meshes : null };
});

const line = (t, r) => {
  const f = r.f;
  if (!f) return `t+${t.toFixed(1)}s  no probe`;
  return `t+${String(t.toFixed(1)).padStart(5)}s  ready ${f.ready ? 'Y' : 'n'}`
    + `  org ${String(Math.round(f.originX)).padStart(6)},${String(Math.round(f.originZ)).padStart(6)}`
    + `  sweep ${f.sweeping ? String(f.row).padStart(3) + '/' + f.of : '  -  '}`
    + `  bands ${f.bandsVisible}/${f.bands}`
    + `  shrubs ${String(f.shrubs).padStart(4)}`
    + `  sum ${String(f.sum).padStart(12)}`
    + `  residual med ${String(f.residualMed).padStart(8)} p90 ${String(f.residualP90).padStart(8)}`
    + `  (${f.sampled} sampled, ${f.noGround} no ground)`
    + `  sweeps ${f.ledger.sweeps}  tiles ${r.tiles}`;
};

const run = async () => {
  const q = `?lat=${flat}&lon=${flon}&h=${fh}&cam=chase&time=NOON&wx=clear${NODRAW ? '&nodraw=1' : ''}${ARGS ? `&${ARGS}` : ''}`;
  const d = await openDrive({ spot: q, tag: 'swardhop', settle: 0, bootTimeout: 240000 });
  try {
    console.log(`FROM ${FROM}  TO ${TO}  drive ${DRIVE} m  ${ARGS || 'no args'}  ${NODRAW ? 'NODRAW — this run judges no picture' : 'DRAWING'}`);
    // Settle the FIRST place so the field it commits is genuinely that place's.
    // A hop taken over a field that was never right cannot show the fault.
    const t0 = Date.now();
    let before = null;
    for (;;) {
      before = await read(d);
      const f = before.f;
      if (f && f.ready && !f.sweeping && f.sampled > 50 && f.residualMed !== null && f.residualMed < 3) break;
      if (Date.now() - t0 > 180000) throw new Error('the first place never committed a field of its own ground');
      await d.page.waitForTimeout(1000);
    }
    console.log('\nSETTLED AT THE FIRST PLACE');
    console.log(line(0, before));
    if (SHOTS) await d.page.screenshot({ path: `${process.env.DRIVE_WORK || "/tmp/drive-tools"}/swardhop-before.png`, timeout: 240000 });

    if (DRIVE > 0) {
      await d.page.evaluate((m) => { const dr = window.__drive; dr.z -= m; }, DRIVE);
      await d.page.waitForTimeout(2000);
      console.log(`drove ${DRIVE} m: ` + line(0, await read(d)));
    }

    const at = await read(d);
    console.log(`\nHOP  truck at ${at.x},${at.z} — the old field's centre is `
      + `${at.f.offCentreM} m off the focus (the rebuild trigger is ${at.f.rebuildAt} m)`);
    await d.page.evaluate(([la, lo, h]) => window.__hop(la, lo, h), [tlat, tlon, th]);

    const hopAt = Date.now();
    const rows = [];
    for (;;) {
      const t = (Date.now() - hopAt) / 1000;
      if (t > SECS) break;
      const r = await read(d);
      rows.push({ t, r });
      console.log(line(t, r));
      await d.page.waitForTimeout(EVERY);
    }
    if (SHOTS) await d.page.screenshot({ path: `${process.env.DRIVE_WORK || "/tmp/drive-tools"}/swardhop-after.png`, timeout: 240000 });

    // ── THE READING ──
    //
    // THE CLAIM IS THE CHECKSUM, NOT THE RESIDUAL. A field committed for
    // another place is not approximately wrong, it is the wrong data — and a
    // residual cannot say so on its own, because every height here is relative
    // to its own origin's baseElev and two places can differ in LOCAL height by
    // a few metres while being continents apart. The checksum is over the
    // committed heights and densities: identical to the pre-hop one means the
    // last place's field, exactly.
    const before0 = before.f.sum;
    const carried = rows.filter((x) => x.r.f && x.r.f.bandsVisible > 0
      && x.r.f.ready && x.r.f.sum === before0);
    const lastCarried = carried.length ? carried[carried.length - 1].t : null;
    // And the residual says what it COST, in metres of grass standing off the
    // ground. Judged only where there is ground to compare against: a sample
    // over unstreamed terrain is not evidence either way, and counting it as
    // agreement is how an empty world reads as clean.
    const judged = rows.filter((x) => x.r.f && x.r.f.sampled > 50
      && x.r.f.residualMed !== null && x.r.f.bandsVisible > 0);
    const worst = judged.reduce((a, x) => Math.max(a, x.r.f.residualMed), 0);
    const worstP90 = judged.reduce((a, x) => Math.max(a, x.r.f.residualP90), 0);
    console.log('\n── THE READING ──');
    console.log(`the field the last place committed: sum ${before0}`);
    console.log(`samples DRAWING that exact field after the hop: ${carried.length} of ${rows.length}`);
    console.log(`the last of them at t+${lastCarried === null ? '—' : lastCarried.toFixed(1)}s`);
    console.log(`most shrubs standing on that carried field: `
      + `${carried.length ? Math.max(...carried.map((x) => x.r.f.shrubs)) : 0}`);
    console.log(`worst median residual while any band drew: ${worst.toFixed(1)} m (p90 ${worstP90.toFixed(1)})`);
    const firstClean = judged.find((x) => x.r.f.residualMed <= 2);
    console.log(`first sample with the field within 2 m of its ground: `
      + `t+${firstClean ? firstClean.t.toFixed(1) : '—'}s`);
    console.log(`\n${carried.length === 0 ? 'ok' : 'FAIL'}  the hop stands the sward down`);
    if (SHOTS) console.log(`frames in ${process.env.DRIVE_WORK || "/tmp/drive-tools"}`);
  } finally { await d.close(); }
};
run().catch((e) => { console.error(e); process.exit(1); });
