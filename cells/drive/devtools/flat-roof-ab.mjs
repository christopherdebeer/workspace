/**
 * ── ARE THE FLAT ROOFS BLACK, AND DO THEY HAVE ANYTHING ON THEM? ──
 *
 *   node devtools/flat-roof-ab.mjs                 (both A/Bs, Suresnes)
 *   FIX=at-campsbay SHOTS=1 node devtools/flat-roof-ab.mjs
 *
 * Reported from the seat: flat roofs render dead black, and they should be
 * proper flat roofs with a parapet and some plant on them. Two switches, two
 * separate questions, and this tool answers each with its own control:
 *
 *   ?bldface=0  the extrusion stays MIRRORED — winding reversed against its
 *               own normal attribute, so DoubleSide flips the shading normal
 *               inward and the cap receives no sunlight at all.
 *   ?bldpara=0  the parapet and the rooftop units come off, leaving the lid.
 *
 * WHY roof-light.mjs COULD NOT SETTLE IT, and what is different here. That
 * tool stands the truck on "the biggest footprint within 400 m" and reads a
 * box at the frame's centre. Three things go wrong, and the third is the one
 * that mattered:
 *
 *   · the biggest footprint is as likely to be PITCHED as flat. Here the
 *     building is chosen by its actual roof form, through `__bldroofs('flat')`.
 *   · a box sized as a FRACTION of the frame is a box of unknown size in
 *     metres. Here it is sized from `__scale().mppCss` and stated in metres,
 *     and the zoom is polled until it has settled — `__zoom` sets a TARGET the
 *     frame loop eases toward, and two runs photographed after a fixed wait
 *     came back at a 45 m frame and a 32 m frame, which is not an A/B.
 *   · AND THE TRUCK IS ALWAYS AT THE CENTRE OF A TOP VIEW. Standing the rig
 *     on a roof to put that roof under the middle of the frame puts the RIG
 *     under the middle of the frame; the box reads its bonnet. Measured: the
 *     control and the fix returned sRGB [78,48,37] and [78,48,37] — the same
 *     truck, twice. `__hide('rig')` takes the 3D model away and the HUD still
 *     draws its own vehicle MARKER there, on a canvas no scene switch reaches,
 *     so the box is read as a RING of eight small samples at a radius clear of
 *     the marker, and the median is the roof. The spread across the eight is
 *     printed beside it: eight samples on one flat roof agree, and one that
 *     has slid off an eave says so.
 *
 * A sample that cannot be shown to be on the surface it names is not a
 * measurement.
 *
 * THE CLOCK AND THE SKY ARE PINNED (`time=NOON&wx=clear`) because weather is
 * rolled per boot and an A/B of two skies is an A/B of nothing — the lesson
 * the wave shots paid for. A FIXTURE, so no tile arrival can move the answer.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/drive-tools/flat-roof';
mkdirSync(OUT, { recursive: true });
const FIX = process.env.FIX ?? 'at-paris-west';
const MODE = process.env.MODE ?? 'fix';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

/** Decode the screenshot in Chromium and sample boxes — the live canvas reads
 *  back black (no preserveDrawingBuffer), see facade-light.mjs. */
const SAMPLE = async ({ b64, boxes }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const out = { size: [w, h] };
  for (const [name, fx, fy, fw, fh] of boxes) {
    const d = ctx.getImageData(Math.round(w * fx), Math.round(h * fy),
      Math.max(1, Math.round(w * fw)), Math.max(1, Math.round(h * fh))).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= n * 255; g /= n * 255; b /= n * 255;
    out[name] = {
      srgb: [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)],
      lum: +(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(4),
    };
  }
  return out;
};

/** Two PNGs in, the share of the terrain pane that differs and by how much. */
const DIFF = async ({ a, b, top, bot }) => {
  const load = async (s) => {
    const img = new Image();
    img.src = `data:image/png;base64,${s}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0);
    return { d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const A = await load(a), B = await load(b);
  if (A.w !== B.w || A.h !== B.h) return { error: 'size mismatch' };
  const y0 = Math.round(A.h * top), y1 = Math.round(A.h * bot);
  let n = 0, moved = 0, sum = 0, worst = 0, la = 0, lb = 0;
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (d, i) => 0.2126 * lin(d[i] / 255) + 0.7152 * lin(d[i + 1] / 255) + 0.0722 * lin(d[i + 2] / 255);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < A.w; x++) {
      const i = (y * A.w + x) * 4;
      const dm = Math.max(Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2]));
      n++; sum += dm; if (dm > 3) moved++; if (dm > worst) worst = dm;
      la += lum(A.d, i); lb += lum(B.d, i);
    }
  }
  return {
    pixels: n, movedShare: +(moved / n).toFixed(4), meanDelta: +(sum / n).toFixed(2), worst,
    lumA: +(la / n).toFixed(4), lumB: +(lb / n).toFixed(4),
  };
};

/** The point in a ring furthest from every one of its edges, and that clearance
 *  in metres — so the caller can say how big a box it may read there. */
function deepest(ring) {
  const pts = ring.filter((p, i) => i === 0 || Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > 1e-6);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const inside = (x, z) => {
    let i2 = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) i2 = !i2;
    }
    return i2;
  };
  const edgeDist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [x1b, z1b] = pts[i], [x2b, z2b] = pts[(i + 1) % pts.length];
      const dx = x2b - x1b, dz = z2b - z1b, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1b) * dx + (z - z1b) * dz) / l2));
      best = Math.min(best, Math.hypot(x - (x1b + t * dx), z - (z1b + t * dz)));
    }
    return best;
  };
  let best = null;
  const N = 24;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = x0 + ((x1 - x0) * i) / N, z = z0 + ((z1 - z0) * j) / N;
      if (!inside(x, z)) continue;
      const d = edgeDist(x, z);
      if (!best || d > best.clear) best = { x: +x.toFixed(2), z: +z.toFixed(2), clear: +d.toFixed(2) };
    }
  }
  return best ?? { x: pts[0][0], z: pts[0][1], clear: 0 };
}

/** One boot: settle, find a flat roof, stand on it, photograph it from above
 *  and read the centre box. Returns the numbers and the PNG. */
async function run(label, extra) {
  // BOOTED WITH nodraw=1 AND DRAWN ONLY FOR THE FRAME. Headless paints at two
  // to four frames a second and the world build is paced by the frame loop, so
  // settling with the draws on is the eleven-minute path; `__draw(true)` turns
  // them back on for the one frame that is the measurement.
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&sunalt=62&cprobe=1&nodraw=1&${extra}`,
    tag: `fr-${label}`, settle: 0, bootTimeout: 180000, dpr: 1,
  });
  const q = (fn, ...a) => d.page.evaluate(fn, ...a);
  // The three-signal gate: a stable count is not a settled world.
  let quiet = 0, pw = -1, pc = -1;
  for (let i = 0; i < 160; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => window.__tstats());
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells;
    if (quiet >= 4) break;
  }
  // WHAT THE ROOFS COST, from the scene's own books rather than an estimate:
  // buildings are the cheapest thing in this world (10 draw calls at Suresnes)
  // and a parapet is six triangles an edge, so the bill is worth a number.
  const census = await q(() => {
    const c = window.__census();
    return { building: c.byTris?.building ?? null, ruin: c.byTris?.ruin ?? null };
  }).catch(() => null);
  const roofs = await q(() => window.__bldroofs(320, 'flat'));
  const all = await q(() => window.__bldroofs(320));
  // A FLAT ROOF WIDE ENOUGH TO HOLD THE SAMPLE BOX, AND NEAR THE FIXTURE'S
  // MIDDLE. Biggest-anywhere put the camera on a 3,239 m² block 549 m out, at
  // the edge of a 700 m capture, with half the frame void — a frame that
  // cannot be read whatever is in the middle of it. A capture is built from
  // its origin outward, so nearest to the origin is nearest to a full frame.
  const wide = (roofs.list ?? []).filter((b) => b.short >= 12);
  const pick = wide.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] ?? (roofs.list ?? [])[0];
  if (!pick) { await d.close(); return { label, error: 'no flat roof in range', forms: all.forms }; }
  // THE DEEPEST POINT IN THE RING, so the sample box is provably on roof and
  // not over an eave: the ring's own vertices scanned on a grid, the candidate
  // furthest from every edge winning. A centroid is not enough — an L-plan's
  // lies outside its own footprint.
  const stand = deepest(pick.ring);
  await q((p) => { window.__place(p.x, p.z); window.__drive.speed = 0; }, stand);
  await q(() => window.__draw(true));
  await q(() => window.__cam('top'));
  await q(() => window.__hide('rig'));
  // AND THE HUD OFF. `__hide('rig')` takes the 3D model away; the HUD draws its
  // own vehicle MARKER at the frame's exact centre on a canvas no scene switch
  // reaches, and every box read near the middle of a top view was reading it.
  await q(() => window.__hud(false));
  const hidden = await q(() => window.__hide());
  // THE ZOOM IS A TARGET THE FRAME LOOP EASES TOWARD, and a harness frame is
  // a third of a second: a fixed wait photographs whatever the ease had
  // reached. Polled until two reads agree.
  await q(() => window.__zoom(0.35));
  let mpp = -1;
  for (let i = 0; i < 40; i++) {
    await d.page.waitForTimeout(600);
    const m = await q(() => window.__scale().mppCss);
    if (Math.abs(m - mpp) < 1e-4) break;
    mpp = m;
  }
  await d.page.waitForTimeout(2000);
  const cam = await q(() => window.__cam());
  const sc = await q(() => window.__scale());
  const buf = await d.page.screenshot({ timeout: 180000 });
  writeFileSync(`${OUT}/${FIX}-${label}.png`, buf);
  const b64 = buf.toString('base64');
  // The box in METRES, not in fractions: `__scale().mppCss` is ground metres
  // per CSS pixel (the art's own mpp divided by the magnification), and the
  // screenshot is CSS pixels at dpr 1 — so a box of 0.09 of the frame is a
  // stated number of metres and can be checked against the footprint.
  // THE SAMPLE POINT IS THE DEEPEST POINT IN THE RING, not its centroid: an
  // L-plan's centroid can lie outside its own footprint, and a box at the
  // frame's exact middle would sit where the rig was. Chosen in node over the
  // ring the probe handed back, then converted to a screen fraction through
  // the chart's own metres-per-pixel — a top view looks straight down, so a
  // metre of ground is mppCss of glass in both axes, and the map rotation is
  // zero with the truck stopped and facing north… which is NOT assumed: the
  // box is put at the frame's centre and the TRUCK is moved to the sample
  // point instead, with the rig hidden.
  // NINE SMALL BOXES over the roof's own clearance — the centre and a ring —
  // rather than one big one: a top view is TILTED (about 70 degrees at this
  // zoom), so a box is a stated number of metres across and an unstated number
  // along, and nine small samples with their spread reported says whether they
  // all landed on the same surface where one large one could only average
  // whatever it covered.
  const R = 0.05, B = 0.035;
  const ring9 = [['c', 0.5 - B / 2, 0.5 - B / 2, B, B]];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ring9.push([`r${k}`, 0.5 + Math.cos(a) * R - B / 2, 0.5 + Math.sin(a) * R - B / 2, B, B]);
  }
  // AND EACH ONE IS ASKED WHAT IT IS STANDING ON. `__pick` raycasts the scene
  // through a screen point and names the mesh it hits, so "the box is on the
  // roof" is a fact the page states rather than a hope the tool holds. Any
  // sample that is not on a building is dropped before the median.
  const on = await q((boxes) => boxes.map(([n, fx, fy, w, h]) => {
    const nx = (fx + w / 2) * 2 - 1, ny = 1 - (fy + h / 2) * 2;
    const hit = window.__pick(nx, ny)[0];
    return [n, hit?.name ?? '', hit ? hit.point[1] : null];
  }), ring9);
  const px = await q(SAMPLE, { b64, boxes: [...ring9, ['away', 0.06, 0.06, 0.08, 0.08]] });
  const onBld = new Set(on.filter(([, name]) => name === 'building').map(([n]) => n));
  // EVERY SAMPLE IS KEPT WITH WHAT IT HIT, so the diff pass can take the
  // median over the samples that landed on a building IN EVERY RUN. The sets
  // are not identical between variants by construction — a parapet stands a
  // metre higher than the lid it replaced, so a ray that used to pass over the
  // roof and hit the rig behind it now hits the parapet — and a median over
  // different sample sets is a comparison of the sets.
  const cellsAll = Object.fromEntries(ring9.map(([n]) => [n, { ...px[n], hit: onBld.has(n) }]));
  const cells = ring9.filter(([n]) => onBld.has(n)).map(([n]) => px[n]).sort((a, b) => a.lum - b.lum);
  if (!cells.length) { await d.close(); return { label, error: 'no sample landed on a building', pick, on }; }
  const mid = cells[Math.floor(cells.length / 2)];
  px.roof = { srgb: mid.srgb, lum: mid.lum, lo: cells[0].lum, hi: cells[cells.length - 1].lum,
    spread: +(cells[cells.length - 1].lum - cells[0].lum).toFixed(4), n: cells.length, of: ring9.length };
  px.cells = cellsAll;
  const groundW = sc.mppCss * px.size[0];
  await d.close();
  return {
    label, pick: { ...pick, ring: undefined }, stand, hidden: hidden.hidden, rigShown: hidden.rig,
    on, cells: px.cells, forms: all.forms, flat: roofs.n, census, zoom: cam.zoom, mppCss: +sc.mppCss.toFixed(3),
    boxM: +(groundW * 0.09).toFixed(1), frameM: +groundW.toFixed(0),
    roof: px.roof, away: px.away, b64,
  };
}

const VARIANTS = {
  face0: 'bldface=0&bldpara=0',   // the world as it was: the mirrored extrusion, a bare lid
  face1: 'bldface=1&bldpara=0',   // the winding put back, nothing else
  fix: 'bldface=1&bldpara=1',     // …and the parapet and the plant
};

if (MODE !== 'diff') {
  const extra = VARIANTS[MODE];
  if (!extra) throw new Error(`MODE must be one of ${Object.keys(VARIANTS).join(', ')}, diff`);
  const r = await run(MODE, extra);
  if (r.error) { console.log(`[${el()}] ${MODE}: ${r.error} · forms ${JSON.stringify(r.forms)}`); process.exit(1); }
  const { b64, ...keep } = r;
  writeFileSync(`${OUT}/${FIX}-${MODE}.json`, JSON.stringify(keep, null, 1));
  console.log(`[${el()}] ${MODE}`);
  console.log(`  roof forms in the fixture: ${JSON.stringify(r.forms)}  (flat within 600 m: ${r.flat})`);
  console.log(`  standing on id ${r.pick.id}: ${r.pick.area} m2, short side ${r.pick.short} m, height ${r.pick.h} m`);
  console.log(`  sample point ${r.stand.x},${r.stand.z} — ${r.stand.clear} m clear of the nearest eave`);
  console.log(`  sample box ${r.boxM} m across, in a ${r.frameM} m frame at ${r.mppCss} m/css-px`);
  console.log(`  ROOF sRGB ${JSON.stringify(r.roof.srgb)} lum ${r.roof.lum} (median of ${r.roof.n} of ${r.roof.of} samples ON A BUILDING, ${r.roof.lo}..${r.roof.hi}, spread ${r.roof.spread})`);
  console.log(`  ground away from the building: sRGB ${JSON.stringify(r.away.srgb)} lum ${r.away.lum}`);
  console.log(`  hidden: ${JSON.stringify(r.hidden)} (rig drawn: ${r.rigShown})   buildings: ${JSON.stringify(r.census)}`);
  console.log(`  what each sample hit: ${r.on.map(([n, w]) => `${n}:${w || 'sky'}`).join(' ')}`);
  console.log(`  frame ${OUT}/${FIX}-${MODE}.png`);
  process.exit(0);
}

// ── THE DIFF PASS ──
const have = {};
for (const k of Object.keys(VARIANTS)) {
  const png = `${OUT}/${FIX}-${k}.png`, js = `${OUT}/${FIX}-${k}.json`;
  if (existsSync(png) && existsSync(js)) have[k] = { b64: readFileSync(png).toString('base64'), r: JSON.parse(readFileSync(js, 'utf8')) };
}
const ks = Object.keys(have);
if (ks.length < 2) throw new Error(`need at least two runs in ${OUT}; have ${ks.join(', ') || 'none'}`);
// THE SAMPLES THAT LANDED ON A BUILDING IN EVERY VARIANT, and nothing else.
const common = ks.reduce((acc, k) => acc.filter((n) => have[k].r.cells?.[n]?.hit), Object.keys(have[ks[0]].r.cells ?? {}));
console.log(`the roof sample, one row per variant (the same building, the same clock, the same sky)`);
console.log(`common samples on a building in all ${ks.length} runs: ${common.length ? common.join(' ') : 'none'}`);
for (const k of ks) {
  const r = have[k].r;
  if (common.length) {
    const ls = common.map((n) => r.cells[n].lum).sort((a, b) => a - b);
    const med = ls.length % 2 ? ls[(ls.length - 1) / 2] : +((ls[ls.length / 2 - 1] + ls[ls.length / 2]) / 2).toFixed(4);
    console.log(`  ${k.padEnd(6)} COMMON median lum ${String(med).padEnd(8)} (${ls.join(', ')})`);
  }
  console.log(`  ${k.padEnd(6)} sRGB ${String(r.roof.srgb).padEnd(15)} lum ${String(r.roof.lum).padEnd(8)} (${r.roof.n}/${r.roof.of} on a building, spread ${r.roof.spread}) · ground away lum ${r.away.lum}`);
  if (r.census) console.log(`         buildings: ${JSON.stringify(r.census)}`);
}
// The pane only: a worst-pixel number over a frame with a status line in it is
// a measurement of the status line.
const d = await openDrive({ spot: `fixture=${FIX}&nodraw=1&cprobe=1`, tag: 'fr-diff', settle: 0, bootTimeout: 180000, dpr: 1 });
for (const [a, b] of [['face0', 'face1'], ['face1', 'fix'], ['face0', 'fix']]) {
  if (!have[a] || !have[b]) continue;
  const r = await d.page.evaluate(DIFF, { a: have[a].b64, b: have[b].b64, top: 0.14, bot: 0.86 });
  console.log(`diff ${a} -> ${b}: moved ${(r.movedShare * 100).toFixed(2)}% of the pane, mean ${r.meanDelta}/255, worst ${r.worst}, pane luma ${r.lumA} -> ${r.lumB}`);
}
await d.close();
console.log(`[${el()}] frames in ${OUT}`);
