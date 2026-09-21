// The brush's work as an authored entry: sculpt the DEM in the world lab,
// then ask __authoredDem for the dry-run — every moved cell, as [lat, lon,
// metres], grouped under the z16 tile it falls in. Nothing is filed (dry).
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const d = await openDrive({ pagePath: '/lab/world-edit?fixture=tee&time=MORNING&cam=chase', tag: 'authored-dem-export', settle: 6000, bootTimeout: 45000 });
await d.page.waitForFunction(() => typeof window.__worldedit === 'function' && window.__worldedit().tiles > 0, null, { timeout: 45000 });
const r = await d.page.evaluate(async () => {
  const layer = document.getElementById('world-authoring-layer');
  layer.value = 'dem';
  layer.dispatchEvent(new Event('change', { bubbles: true }));
  const empty = await window.__authoredDem?.({ dry: true });
  const painted = window.__worldeditPaint?.(undefined, undefined, 'raise', 45, 2);
  const dry = await window.__authoredDem?.({ dry: true });
  return { empty, painted, dry };
});
console.log(JSON.stringify(r));
ok('before any stroke the export is empty', r.empty && Object.keys(r.empty).length === 0, r.empty);
ok('the stroke moved cells', r.painted?.editedCells > 0, r.painted);
const tiles = Object.entries(r.dry ?? {});
ok('the export lists the moved cells under one or more z16 tiles', tiles.length > 0 && tiles.every(([k, v]) => /^16\/\d+\/\d+$/.test(k) && v.dems > 0), r.dry);
ok('…and every moved cell is in it', tiles.reduce((n, [, v]) => n + v.dems, 0) === r.painted?.editedCells, { dry: r.dry, edited: r.painted?.editedCells });
report(d.errors);
await d.close();
console.log(bad ? `${bad} FAILED` : 'authored-dem-export: all ok');
process.exit(bad ? 1 : 0);
