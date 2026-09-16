/**
 * ── THE CONTACT SHEET: EVERY VARIANT'S SKELETON WITH ITS OWN IMPOSTOR ──
 *
 *   node cells/drive/devtools/imp-sheet.mjs          (200 m, the handover)
 *   DIST=400 node .../imp-sheet.mjs                  (further out)
 *   ELEV=8,32 node .../imp-sheet.mjs                 (two elevation rows)
 *   AZ=22 node .../imp-sheet.mjs                     (between two atlas tiles)
 *   INK=1 node .../imp-sheet.mjs                     (black silhouettes)
 *
 * The seat's ask, verbatim: *I'm concerned that imposters don't look enough
 * like their counterparts, noticeable when swapped. Can we show a contact
 * sheet of imposters and their reals side by side?*
 *
 * Each cell is the SAME variant twice — the baked skeleton on the left and its
 * baked impostor card on the right — through one ortho camera, one quantiser
 * and one set of metrics, at the art-pixel size the game draws that tree at
 * from DIST metres. The two halves share their box by construction: the
 * atlas's bake frames its tiles with exactly the hx/hy/cy this sheet's camera
 * is framed by, so a disagreement between them is the impostor's.
 *
 * **IOU IS THE COLUMN THE ASK IS ABOUT** — the intersection over union of the
 * two silhouettes. Everything else describes a half; only this compares them.
 * Beside it `cov`, `h` and `w` say WHICH WAY a card is wrong (thinner, shorter,
 * narrower) and `lum` says whether it is the light rather than the shape.
 *
 * AND THE AZIMUTH MATTERS, which is why it is an option. The atlas holds eight
 * azimuths and the card MIXES the two nearest, so a sheet taken at az 0 is
 * taken exactly on a baked tile and reads the atlas at its best; az 22.5 is the
 * worst case, halfway between two tiles, and the difference between the two
 * runs is what the eight-azimuth choice costs.
 *
 * IT SPENDS NONE OF THE WORLD'S ATLAS. The probe bakes into a target of its
 * own and re-uses slot zero, because `impSlotFor` is append-only and a sheet
 * that took thirty-seven permanent slots would leave the district's own
 * variants locked out for the rest of the session.
 *
 * WHAT IT FAILS ON is structural and nothing else: a card that draws NOTHING
 * where the tree it stands in for has something a 32 px tile could carry. A
 * bar on `iou` would be a threshold nobody has earned yet — the sheet exists
 * to establish what that number IS, and the frames are the judgement.
 *
 * AND `EMPTY` AND `SUB-PIXEL` ARE COUNTED APART, because they are different
 * facts. A snag at 200 m is two or three isolated black pixels — 1% of its own
 * box — and a tile cannot carry that under a binary alpha test, which is a
 * statement about the snag rather than about the bake. The gate is 3% of the
 * cell, and the control that says it is not a bar moved to pass: before the
 * atlas's y axis was fixed EVERY card drew nothing and thirty-five of the
 * thirty-seven were over that gate.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.DRIVE_WORK ?? '/tmp/drive-tools';
const FIX = process.env.FIX ?? 'at-yosemite';
const ELEVS = (process.env.ELEV ?? '8').split(',').map(Number);
const DIST = Number(process.env.DIST ?? 200);
const SCALE = Number(process.env.SCALE ?? 2.5);
const AZ = Number(process.env.AZ ?? 0);
const YAW = Number(process.env.YAW ?? 0);
// PX overrides the distance framing entirely and is the back door for a
// close-up; a sheet taken with it is not a control and the header says so.
const PX = process.env.PX ? Number(process.env.PX) : undefined;
const MAG = Number(process.env.MAG ?? 0);
const COLS = Number(process.env.COLS ?? 3);
const INK = process.env.INK === '1';
const POST = process.env.POST !== '0';
const BG = process.env.BG ?? 'sky';
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
console.log(`[${el()}] booting ${FIX}`);
// ── DRAWING IS ON, AND IT HAS TO BE ──
// A program compiles on its FIRST RENDER, so a `nodraw` run never validates
// the impostor material at all — and this sheet is the one instrument whose
// whole subject is what that material draws. The harness folds a GLSL link
// failure into its own error list, which is checked below.
const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear${process.env.QS ? `&${process.env.QS}` : ''}`,
  tag: 'imp-sheet', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// THE VARIANTS ARE DECODED LAZILY, so ask for them before photographing.
await d.page.waitForTimeout(6000);

const sheets = [];
for (const elev of ELEVS) {
  console.log(`[${el()}] sheet at ${elev} degrees, az ${AZ}`);
  const r = await q((o) => window.__impsheet(o), {
    dist: DIST, scale: SCALE, px: PX, mag: MAG, cols: COLS,
    elev, az: AZ, yaw: YAW, bg: BG, ink: INK, post: POST });
  const file = join(OUT, `imp-sheet-${process.env.TAG ?? 'base'}-e${elev}-a${AZ}.png`);
  writeFileSync(file, Buffer.from(r.sheet.split(',')[1], 'base64'));
  sheets.push({ elev, file, rows: r.rows, meta: r });
}
const errs = d.errors ?? [];
await d.close();

let fail = 0;
for (const s of sheets) {
  const { rows, meta } = s;
  console.log(`\n── impostor against skeleton · ${rows.length} variants`
    + ` · ${PX ? `${PX}px cells (NOT a control)` : `${DIST} m`} · elev ${s.elev}° · az ${AZ}°`
    + ` · top card ${meta.top} · ${POST ? '14 levels + bayer4' : 'NO post'}${INK ? ' · INK' : ''}`);
  console.log(`  ${'variant'.padEnd(22)}${'form'.padEnd(10)}${'px'.padStart(4)}`
    + `${'iou'.padStart(7)}${'cov'.padStart(7)}${'h'.padStart(6)}${'w'.padStart(6)}`
    + `${'dlum'.padStart(6)}${'real'.padStart(16)}${'imp'.padStart(16)}`);
  const half = (h) => `${h.parts}p/${Math.round(h.big * 100)}%/${Math.round(h.cov * 100)}%`;
  const empty = [], tiny = [];
  for (const r of [...rows].sort((a, b) => a.diff.iou - b.diff.iou)) {
    const dd = r.diff;
    if (r.imp.cov === 0) (r.cov >= 0.03 ? empty : tiny).push(r.label);
    console.log(`  ${r.label.padEnd(22)}${r.form.padEnd(10)}${String(r.px).padStart(4)}`
      + `${dd.iou.toFixed(3).padStart(7)}${dd.covR.toFixed(2).padStart(7)}`
      + `${dd.hR.toFixed(2).padStart(6)}${dd.wR.toFixed(2).padStart(6)}`
      + `${String(dd.dLum).padStart(6)}${half(r).padStart(16)}${half(r.imp).padStart(16)}`);
  }
  // ── BY FORM, because a guild asks for a form and not for a variant ──
  const byForm = new Map();
  for (const r of rows) {
    const a = byForm.get(r.form) ?? [];
    a.push(r); byForm.set(r.form, a);
  }
  const mean = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;
  console.log(`\n  by form`);
  console.log(`    ${'form'.padEnd(11)}${'n'.padStart(3)}${'iou'.padStart(8)}${'cov'.padStart(7)}`
    + `${'h'.padStart(6)}${'w'.padStart(6)}${'dlum'.padStart(6)}`);
  for (const [form, a] of [...byForm].sort()) {
    console.log(`    ${form.padEnd(11)}${String(a.length).padStart(3)}`
      + `${mean(a, (r) => r.diff.iou).toFixed(3).padStart(8)}`
      + `${mean(a, (r) => r.diff.covR).toFixed(2).padStart(7)}`
      + `${mean(a, (r) => r.diff.hR).toFixed(2).padStart(6)}`
      + `${mean(a, (r) => r.diff.wR).toFixed(2).padStart(6)}`
      + `${mean(a, (r) => r.diff.dLum).toFixed(0).padStart(6)}`);
  }
  if (tiny.length) console.log(`\n  SUB-PIXEL (${tiny.length}): ${tiny.join(', ')}`
    + ` — the tree's own silhouette is under 3% of its box, which a 32 px tile`
    + ` cannot carry under a binary alpha test`);
  if (empty.length) {
    fail += empty.length;
    console.log(`\n  EMPTY (${empty.length}): ${empty.join(', ')}`
      + ` — a card with nothing where the tree has something to carry`);
  }
  const all = mean(rows, (r) => r.diff.iou);
  console.log(`\n  mean iou ${all.toFixed(3)} · worst ${Math.min(...rows.map((r) => r.diff.iou)).toFixed(3)}`
    + ` · best ${Math.max(...rows.map((r) => r.diff.iou)).toFixed(3)}`);
}
console.log(`\n  sheets: ${sheets.map((s) => s.file).join(' · ')}`);
if (errs.length) {
  console.log(`\n  PAGE ERRORS (${errs.length}) — a GLSL link failure lands here and nowhere else:`);
  for (const e of errs.slice(0, 8)) console.log(`    ${String(e).slice(0, 200)}`);
  fail++;
}
if (fail) console.log(`\n  ${fail} FAILED — a card that draws nothing is a bake that did not land`);
else console.log(`\n  all ok — every card that could carry a silhouette carries one`);
process.exitCode = fail ? 1 : 0;
