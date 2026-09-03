/**
 * A ROAD UNDER THE HILL IS A TUNNEL, NOT AN EXCAVATION.
 *
 *   node cells/drive/devtools/road-hole.test.mjs
 *
 * Reported from the seat at Fish Hoek: the road carve is breaking a hole in
 * the terrain. It was. Highway Road solves a deck at −7.66m under natural
 * ground of +0.22m and holds it for tens of metres, and `carveCorridors` then
 * excavated the town down to meet it — measured on a hard-settled world,
 * `__carve` gave 248 of 305 samples needing the cut with NOT ONE of them an
 * artefact, terrain over target a median 8.29m, and vertices 5–12m past the
 * kerb dropped a median 12.72m with one at 25m out taken down 18.01m. Every
 * corner of the triangle under the road sat exactly on its dig limit: the
 * carve was not overshooting, it was spending exactly what it was licensed.
 *
 * `tn` is the only thing that stops that — `rasterizeCut` returns on it, so
 * the segment never reaches `cutCells` — and nothing was setting it, because
 * the burial scan ran only INSIDE runs the tunnel detector had already found,
 * and that detector looks for a knoll in the along-way profile rather than for
 * ground over the deck. On a smooth grade it never fires. `__tunnelBreach`
 * reported zero tunnel meshes in the entire world.
 *
 * So the law, and it is about the CARVE's licence rather than about tunnels:
 *
 *   NO BUILT CARRIAGEWAY IS LEFT WITH METRES OF GROUND OVER IT AND NO
 *   EXEMPTION FROM THE CARVE.
 *
 * `__buried` is deliberately name-free. `__profile` and `__bury` both select
 * on `s.nm`, and asking them about this hole returned "0 buried" while the
 * road was eight metres under the ground — the query was looking at named
 * roads and the offender was reached under a different name than the one
 * guessed. An empty answer from the wrong question reads exactly like an
 * exoneration, and it cost this investigation a full round.
 *
 * THE WORLD MUST BE SETTLED. Both boots poll until the built count stops
 * climbing: a road solved against half-arrived terrain is a different bug with
 * the same symptom, and a measurement taken mid-stream cannot tell them apart.
 */
import { openDrive, report, CELL, ROOT } from './harness.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const SPOT = 'lat=-34.14339&lon=18.43132&h=128&cam=chase&cprobe=1&time=NOON';
const TUBE_TH = 5.6;         // TUNNEL_H + 0.6, the code's own burial threshold

// The control is the build before the fix, which has no `__buried` — grafted
// in just INSIDE the route branch's closing brace, because almost all of
// main.ts lives in that block and `roadGrid`/`state`/`sampleHeight` are its
// locals. Appending past the brace is a ReferenceError on the first read.
const PROBE = `
;(window).__buried = (r = 400) => {
  const seen = new Set(); const exposed = []; const exempt = [];
  let deep = 0, missedByMin = 0, segs = 0, worst = 0, worstAt = null;
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (seen.has(s) || s.ya === undefined || s.yb === undefined) continue;
    seen.add(s);
    const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
    if (Math.hypot(mx - state.x, mz - state.z) > r) continue;
    segs++;
    if (s.tk) continue;
    const deck = (s.ya + s.yb) / 2;
    const over = sampleHeight(mx, mz) - deck;
    const dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz) || 1;
    const ox = (-dz / l) * (s.hw + 1.2), oz = (dx / l) * (s.hw + 1.2);
    const overMin = Math.min(sampleHeight(mx, mz),
      sampleHeight(mx + ox, mz + oz), sampleHeight(mx - ox, mz - oz)) - deck;
    if (over <= 0.5) continue;
    if (s.tn || s.pc !== undefined) { exempt.push(over); continue; }
    exposed.push(over);
    if (over > 5.6) { deep++; if (overMin <= 5.6) missedByMin++; }
    if (over > worst) { worst = over; worstAt = [Math.round(mx), Math.round(mz)]; }
  }
  const stat = (v) => { if (!v.length) return null;
    const q = v.slice().sort((a, b) => a - b);
    return { n: q.length, med: +q[q.length >> 1].toFixed(2), max: +q[q.length - 1].toFixed(2) }; };
  return { segs, r, exposed: stat(exposed), exempt: stat(exempt),
    deeperThanTube: deep, missedByWidthMin: missedByMin,
    worst: +worst.toFixed(2), worstAt };
};
`;
const BLOCK_END = '} // HYDRO_LAB route branch';
const OLD_SRC = join(CELL, 'client/__roadhole-rev.ts');
/**
 * THE CONTROL IS A PINNED COMMIT, NOT `HEAD`.
 *
 * The first version of this read `git show HEAD:…`, and HEAD MOVED while the
 * test was running: the fix was committed between the "after" boot and the
 * control boot, so the control built the fixed code and reported it as the
 * before. `before` and `after` came out within two segments of each other and
 * both had the tunnel mesh the fix creates, and the last check passed
 * vacuously — which is the exact failure mode a control exists to prevent,
 * wearing a passing grade.
 *
 * `03fddf3` is the commit before the burial scan was moved out of `runs`.
 */
const CONTROL_REV = '03fddf3';

function buildControl() {
  const src = execSync(`git show ${CONTROL_REV}:cells/drive/client/main.ts`,
    { cwd: ROOT, maxBuffer: 64e6 }).toString();
  const at = src.lastIndexOf(BLOCK_END);
  if (at < 0) throw new Error(`cannot graft the probe: no ${JSON.stringify(BLOCK_END)} in ${CONTROL_REV}'s main.ts`);
  writeFileSync(OLD_SRC, src.slice(0, at) + PROBE + src.slice(at));
  return OLD_SRC;
}

const errors = [];

/** Boot, wait for the world to stop arriving, then read what is buried. */
async function run(control) {
  const d = await openDrive({
    spot: SPOT, tag: `road-hole-${control ? 'before' : 'after'}`,
    settle: 20000, bootTimeout: 150000, ...(control ? { src: buildControl() } : {}),
  });
  const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
  let last = -1, still = 0;
  for (let i = 0; i < 32; i++) {
    await d.page.waitForTimeout(15000);
    const built = await q(() => window.__built().intact);
    still = built === last ? still + 1 : 0;
    last = built;
    if (built > 200 && still >= 2) break;      // two quiet rounds = arrived
  }
  const out = {
    built: last,
    buried: await q(() => window.__buried(400)),
    tunnels: await q(() => window.__tunnelBreach()),
    carve: await q(() => window.__carve(60)),
    at: await q(() => window.__carveat(0, 0)),
  };
  errors.push(...d.errors);
  await d.close();
  return out;
}

const show = (tag, r) => {
  console.log(`\n${tag}  built=${r.built}  tunnel meshes=${r.tunnels.meshes}`);
  console.log(`${tag}  buried: ${JSON.stringify(r.buried)}`);
  console.log(`${tag}  deck=${r.at.deckDrawn} natural=${r.at.natural} target=${r.at.target}`);
  const drop = r.carve.error ? null : r.carve.dropByDistPastKerb;
  console.log(`${tag}  drops past kerb: ${JSON.stringify(drop)}`);
};

const after = await run(false);
show('after ', after);

check('the world actually arrived', after.built > 200, after.built);
// THE LAW. Not "there are tunnels" — a world may legitimately have none — but
// that nothing is left buried past the tube threshold and still diggable.
check('no carriageway is left buried past the tube threshold with no exemption',
  after.buried.deeperThanTube === 0, after.buried);
check('…and the deepest unexempted cover is under the threshold',
  after.buried.worst < TUBE_TH, { worst: after.buried.worst, at: after.buried.worstAt });

// ── the control: the same measurement on the build before the fix ──
let before;
try {
  before = await run(true);
} finally {
  // Or a stray file is left in the cell, and cell-sync push sends every file.
  rmSync(OLD_SRC, { force: true });
}
show('before', before);

check('…and before the fix this spot left carriageway buried and diggable',
  before.buried.deeperThanTube > 0 && before.buried.worst > TUBE_TH, before.buried);

console.log(bad ? `\n${bad} FAILED` : '\nall good — a road under the hill is exempt from the carve');
report(errors);
if (bad) process.exitCode = 1;
